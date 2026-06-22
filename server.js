const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const workflow = require("./workflow");

const app = express();
const PORT = process.env.PORT || 3040;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Fenevision Admin"');
    return res.status(401).send("Authentication required.");
  }
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="Fenevision Admin"');
    return res.status(401).send("Invalid credentials.");
  }
  next();
}

// ---------------------------------------------------------------
// Pages
// ---------------------------------------------------------------
app.get("/approve/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "approve.html"));
});

app.get("/status/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "status.html"));
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private", "admin.html"));
});

// ---------------------------------------------------------------
// API
// ---------------------------------------------------------------
app.post("/api/requests", async (req, res) => {
  const { submitted_by, submitted_by_email, request_type, description, urgency, notes } = req.body || {};
  const required = { submitted_by, submitted_by_email, request_type, description, urgency };
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key);

  if (missing.length) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitted_by_email)) {
    return res.status(400).json({ error: "submitted_by_email is not a valid email address." });
  }

  try {
    const request = await workflow.submitRequest({
      submitted_by,
      submitted_by_email,
      request_type,
      description,
      urgency,
      notes,
    });
    res.json({ ok: true, id: request.id });
  } catch (err) {
    console.error("Failed to submit request:", err);
    res.status(500).json({ error: "Failed to submit request. Please try again or contact IT directly." });
  }
});

app.get("/api/approval/:token", async (req, res) => {
  try {
    const info = await workflow.getApprovalInfo(req.params.token);
    if (!info) return res.status(404).json({ error: "Invalid or expired link." });
    res.json(info);
  } catch (err) {
    console.error("Failed to load approval info:", err);
    res.status(500).json({ error: "Failed to load request details." });
  }
});

app.post("/api/approval/:token/decide", async (req, res) => {
  const { decision, comments } = req.body || {};
  if (decision !== "approve" && decision !== "reject") {
    return res.status(400).json({ error: "decision must be 'approve' or 'reject'." });
  }

  try {
    const result = await workflow.handleDecision(req.params.token, decision, comments);
    if (result.notFound) return res.status(404).json({ error: "Invalid or expired link." });
    if (result.alreadyDecided) {
      return res.status(409).json({ error: `This request was already ${result.status}.` });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Failed to record decision:", err);
    res.status(500).json({ error: "Failed to record your decision. Please try again." });
  }
});

app.get("/api/status/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid request id." });

  try {
    const status = await workflow.getStatus(id);
    if (!status) return res.status(404).json({ error: "Request not found." });
    res.json(status);
  } catch (err) {
    console.error("Failed to load status:", err);
    res.status(500).json({ error: "Failed to load request status." });
  }
});

app.get("/api/admin/requests", requireAdmin, async (req, res) => {
  try {
    const requests = await workflow.getAllRequests();
    res.json({ requests });
  } catch (err) {
    console.error("Failed to load admin requests:", err);
    res.status(500).json({ error: "Failed to load requests." });
  }
});

app.listen(PORT, () => {
  console.log(`Fenevision Request server listening on port ${PORT}`);
});
