const crypto = require("crypto");
const db = require("./db");
const mailer = require("./mailer");

function getApproverChain() {
  const chain = [];
  for (let i = 1; i <= 3; i++) {
    const name = (process.env[`APPROVER_${i}_NAME`] || "").trim();
    const email = (process.env[`APPROVER_${i}_EMAIL`] || "").trim();
    if (name && email) {
      chain.push({ step: chain.length + 1, name, email });
    }
  }
  return chain;
}

async function submitRequest({ submitted_by, submitted_by_email, request_type, description, urgency, notes }) {
  const chain = getApproverChain();
  if (chain.length === 0) {
    throw new Error("No approvers are configured.");
  }

  const insertResult = await db.query(
    `INSERT INTO requests (submitted_by, submitted_by_email, request_type, description, urgency, notes, status, current_step)
     OUTPUT INSERTED.*
     VALUES (@submitted_by, @submitted_by_email, @request_type, @description, @urgency, @notes, 'pending', 1)`,
    { submitted_by, submitted_by_email, request_type, description, urgency, notes: notes || null }
  );
  const request = insertResult.recordset[0];

  const steps = [];
  for (const approver of chain) {
    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO approvals (request_id, approver_email, approver_name, step_number, token)
       VALUES (@requestId, @email, @name, @step, @token)`,
      { requestId: request.id, email: approver.email, name: approver.name, step: approver.step, token }
    );
    steps.push({ ...approver, token });
  }

  const first = steps[0];
  await mailer.sendApprovalRequestEmail({
    to: first.email,
    approverName: first.name,
    request,
    stepNumber: first.step,
    totalSteps: chain.length,
    token: first.token,
  });

  return request;
}

async function getApprovalInfo(token) {
  const result = await db.query(`SELECT * FROM approvals WHERE token = @token`, { token });
  const approval = result.recordset[0];
  if (!approval) return null;

  const totalResult = await db.query(
    `SELECT COUNT(*) AS total FROM approvals WHERE request_id = @id`,
    { id: approval.request_id }
  );
  const requestResult = await db.query(`SELECT * FROM requests WHERE id = @id`, { id: approval.request_id });

  return {
    approval,
    request: requestResult.recordset[0],
    totalSteps: totalResult.recordset[0].total,
  };
}

async function handleDecision(token, decision, comments) {
  const result = await db.query(`SELECT * FROM approvals WHERE token = @token`, { token });
  const approval = result.recordset[0];
  if (!approval) return { notFound: true };
  if (approval.status !== "pending") return { alreadyDecided: true, status: approval.status };

  const requestResult = await db.query(`SELECT * FROM requests WHERE id = @id`, { id: approval.request_id });
  const request = requestResult.recordset[0];

  const newStatus = decision === "approve" ? "approved" : "rejected";
  await db.query(
    `UPDATE approvals SET status = @status, comments = @comments, decided_at = SYSUTCDATETIME() WHERE id = @id`,
    { status: newStatus, comments: comments || null, id: approval.id }
  );

  if (decision === "reject") {
    await db.query(
      `UPDATE requests SET status = 'rejected', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: request.id }
    );
    await db.query(
      `UPDATE approvals SET status = 'skipped' WHERE request_id = @id AND status = 'pending'`,
      { id: request.id }
    );
    await mailer.sendRejectionEmail({
      request,
      rejectedByName: approval.approver_name,
      stepNumber: approval.step_number,
      comments,
    });
    return { decision: "rejected" };
  }

  const nextResult = await db.query(
    `SELECT * FROM approvals WHERE request_id = @id AND step_number = @nextStep`,
    { id: request.id, nextStep: approval.step_number + 1 }
  );
  const next = nextResult.recordset[0];

  if (next) {
    await db.query(
      `UPDATE requests SET current_step = @step, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { step: next.step_number, id: request.id }
    );
    const totalResult = await db.query(
      `SELECT COUNT(*) AS total FROM approvals WHERE request_id = @id`,
      { id: request.id }
    );
    await mailer.sendApprovalRequestEmail({
      to: next.approver_email,
      approverName: next.approver_name,
      request,
      stepNumber: next.step_number,
      totalSteps: totalResult.recordset[0].total,
      token: next.token,
    });
    return { decision: "approved", nextStep: next.step_number };
  }

  await db.query(
    `UPDATE requests SET status = 'approved', updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id: request.id }
  );
  const allApprovalsResult = await db.query(
    `SELECT * FROM approvals WHERE request_id = @id ORDER BY step_number`,
    { id: request.id }
  );
  await mailer.sendFinalTicketEmail({ request, approvals: allApprovalsResult.recordset });
  return { decision: "approved", final: true };
}

async function getStatus(id) {
  const requestResult = await db.query(`SELECT * FROM requests WHERE id = @id`, { id });
  const request = requestResult.recordset[0];
  if (!request) return null;
  const approvalsResult = await db.query(
    `SELECT * FROM approvals WHERE request_id = @id ORDER BY step_number`,
    { id }
  );
  return { request, approvals: approvalsResult.recordset };
}

async function resendCurrentApproval(requestId) {
  const requestResult = await db.query(`SELECT * FROM requests WHERE id = @id`, { id: requestId });
  const request = requestResult.recordset[0];
  if (!request) return { notFound: true };
  if (request.status !== "pending") return { notPending: true, status: request.status };

  const approvalResult = await db.query(
    `SELECT * FROM approvals WHERE request_id = @id AND step_number = @step`,
    { id: requestId, step: request.current_step }
  );
  const approval = approvalResult.recordset[0];
  if (!approval) return { notFound: true };

  const totalResult = await db.query(
    `SELECT COUNT(*) AS total FROM approvals WHERE request_id = @id`,
    { id: requestId }
  );

  await mailer.sendApprovalRequestEmail({
    to: approval.approver_email,
    approverName: approval.approver_name,
    request,
    stepNumber: approval.step_number,
    totalSteps: totalResult.recordset[0].total,
    token: approval.token,
  });

  return { ok: true, approverName: approval.approver_name, approverEmail: approval.approver_email };
}

async function getAllRequests() {
  const requestsResult = await db.query(`SELECT * FROM requests ORDER BY created_at DESC`);
  const approvalsResult = await db.query(`SELECT * FROM approvals ORDER BY request_id, step_number`);

  const approvalsByRequest = {};
  for (const a of approvalsResult.recordset) {
    (approvalsByRequest[a.request_id] ||= []).push(a);
  }

  return requestsResult.recordset.map((r) => ({ ...r, approvals: approvalsByRequest[r.id] || [] }));
}

module.exports = {
  getApproverChain,
  submitRequest,
  getApprovalInfo,
  handleDecision,
  getStatus,
  getAllRequests,
  resendCurrentApproval,
};
