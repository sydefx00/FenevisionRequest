const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatCT(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date)) + " CT";
}

function wrapEmail(title, bodyHtml) {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:#222;">
      <div style="background:#0078d4;color:#fff;padding:14px 20px;border-radius:6px 6px 0 0;">
        <h2 style="margin:0;font-size:18px;">${esc(title)}</h2>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;padding:18px 20px;border-radius:0 0 6px 6px;">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function detailRows(rows) {
  return `<table style="border-collapse:collapse;width:100%;max-width:600px;">${rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px;font-weight:600;border-bottom:1px solid #e0e0e0;vertical-align:top;white-space:nowrap;">${esc(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #e0e0e0;">${esc(value)}</td></tr>`
    )
    .join("")}</table>`;
}

async function sendApprovalRequestEmail({ to, approverName, request, stepNumber, totalSteps, token }) {
  const approveUrl = `${process.env.BASE_URL}/approve/${token}`;
  const body = `
    <p>Hi ${esc(approverName)},</p>
    <p>A Fenevision request needs your approval (step ${stepNumber} of ${totalSteps}):</p>
    ${detailRows([
      ["Requested By", `${request.submitted_by} (${request.submitted_by_email})`],
      ["Request Type", request.request_type],
      ["Urgency", request.urgency],
      ["Description", request.description],
      ["Notes", request.notes],
      ["Submitted", formatCT(request.created_at)],
    ])}
    <p style="margin-top:20px;">
      <a href="${approveUrl}" style="background:#0078d4;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:700;">Review Request</a>
    </p>
    <p style="font-size:12px;color:#666;">If the button doesn't work, copy this link: ${approveUrl}</p>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: `Approval Needed: Fenevision Request #${request.id} from ${request.submitted_by}`,
    html: wrapEmail("Fenevision Request - Approval Needed", body),
  });
}

async function sendFinalTicketEmail({ request, approvals }) {
  const approvalHistory = approvals
    .map(
      (a) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e0e0e0;">Step ${a.step_number} - ${esc(a.approver_name)}</td><td style="padding:6px 12px;border-bottom:1px solid #e0e0e0;">${esc(a.status)}</td><td style="padding:6px 12px;border-bottom:1px solid #e0e0e0;">${formatCT(a.decided_at)}</td><td style="padding:6px 12px;border-bottom:1px solid #e0e0e0;">${esc(a.comments)}</td></tr>`
    )
    .join("");

  const body = `
    <p>A Fenevision request has been fully approved and is ready for IT action.</p>
    ${detailRows([
      ["Request #", request.id],
      ["Requested By", `${request.submitted_by} (${request.submitted_by_email})`],
      ["Request Type", request.request_type],
      ["Urgency", request.urgency],
      ["Description", request.description],
      ["Notes", request.notes],
      ["Submitted", formatCT(request.created_at)],
    ])}
    <h3 style="margin-top:20px;font-size:14px;color:#0078d4;">Approval History</h3>
    <table style="border-collapse:collapse;width:100%;max-width:600px;">
      <tr>
        <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc;">Step</th>
        <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc;">Status</th>
        <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc;">Decided</th>
        <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc;">Comments</th>
      </tr>
      ${approvalHistory}
    </table>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.MAIL_TO_ITHELP,
    subject: `New IT Ticket: Fenevision Request #${request.id} - ${request.request_type}`,
    html: wrapEmail("Fenevision Request - Approved (Ticket)", body),
  });
}

async function sendRejectionEmail({ request, rejectedByName, stepNumber, comments }) {
  const body = `
    <p>Hi ${esc(request.submitted_by)},</p>
    <p>Your Fenevision request was rejected by ${esc(rejectedByName)} (step ${stepNumber}).</p>
    ${detailRows([
      ["Request #", request.id],
      ["Request Type", request.request_type],
      ["Description", request.description],
      ["Rejection Comments", comments],
    ])}
    <p style="margin-top:16px;">If you have questions, please follow up with ${esc(rejectedByName)} directly.</p>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: request.submitted_by_email,
    subject: `Fenevision Request #${request.id} - Rejected`,
    html: wrapEmail("Fenevision Request - Rejected", body),
  });
}

module.exports = {
  formatCT,
  sendApprovalRequestEmail,
  sendFinalTicketEmail,
  sendRejectionEmail,
};
