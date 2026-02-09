import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/* ================= GOOGLE AUTH ================= */

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}

if (!process.env.SHARED_DRIVE_ID) {
  console.error("❌ SHARED_DRIVE_ID missing");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/drive"]
});

const drive = google.drive({ version: "v3", auth });

const ROOT_FOLDER_NAME = "UNSAT-SCHOOLS";

/* ================= HELPERS ================= */

/**
 * Get root folder ID from Shared Drive
 */
async function getRootFolderId() {
  const res = await drive.files.list({
    corpora: "drive",
    driveId: process.env.SHARED_DRIVE_ID,
    q: `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (!res.data.files.length) {
    throw new Error("UNSAT-SCHOOLS folder not found in Shared Drive");
  }

  return res.data.files[0].id;
}

/**
 * Get or create a subfolder inside Shared Drive
 */
async function getOrCreateFolder(name, parentId) {
  const res = await drive.files.list({
    corpora: "drive",
    driveId: process.env.SHARED_DRIVE_ID,
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder'`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (res.data.files.length) {
    return res.data.files[0].id;
  }

  const folder = await drive.files.create({
    resource: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    supportsAllDrives: true
  });

  return folder.data.id;
}

/**
 * Upload JSON file (overwrite if exists)
 */
async function uploadJson(parentId, fileName, data) {
  const existing = await drive.files.list({
    corpora: "drive",
    driveId: process.env.SHARED_DRIVE_ID,
    q: `'${parentId}' in parents and name='${fileName}'`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (existing.data.files.length) {
    await drive.files.delete({
      fileId: existing.data.files[0].id,
      supportsAllDrives: true
    });
  }

  await drive.files.create({
    resource: {
      name: fileName,
      parents: [parentId]
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(data, null, 2)
    },
    supportsAllDrives: true
  });
}

/**
 * Read JSON file
 */
async function readJson(parentId, fileName) {
  const res = await drive.files.list({
    corpora: "drive",
    driveId: process.env.SHARED_DRIVE_ID,
    q: `'${parentId}' in parents and name='${fileName}'`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (!res.data.files.length) return [];

  const fileId = res.data.files[0].id;

  const file = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "json" }
  );

  return file.data;
}

/* ================= ROUTES ================= */

app.get("/drive-test", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    res.json({
      success: true,
      message: "Shared Drive connected",
      rootFolderId: rootId
    });
  } catch (e) {
    console.error("DRIVE TEST ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Save school data
 */
app.post("/schools/save", async (req, res) => {
  const { schoolName, students } = req.body;

  if (!schoolName || !Array.isArray(students)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  console.log("SAVE REQUEST:", schoolName);

  try {
    const rootId = await getRootFolderId();
    const schoolFolderId = await getOrCreateFolder(schoolName, rootId);

    await uploadJson(schoolFolderId, "students.json", students);
    await uploadJson(schoolFolderId, "meta.json", {
      schoolName,
      uploadedAt: new Date().toISOString()
    });

    console.log("SAVE SUCCESS:", schoolName);
    res.json({ success: true });
  } catch (e) {
    console.error("SAVE ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * List schools
 */
app.get("/schools", async (req, res) => {
  try {
    const rootId = await getRootFolderId();

    const folders = await drive.files.list({
      corpora: "drive",
      driveId: process.env.SHARED_DRIVE_ID,
      q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(name)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    res.json(folders.data.files.map(f => f.name));
  } catch (e) {
    console.error("LIST ERROR:", e.message);
    res.json([]);
  }
});

/**
 * Get students of a school
 */
app.get("/schools/:schoolName", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    const schoolFolderId = await getOrCreateFolder(req.params.schoolName, rootId);
    const students = await readJson(schoolFolderId, "students.json");
    res.json(students);
  } catch (e) {
    console.error("LOAD ERROR:", e.message);
    res.json([]);
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
