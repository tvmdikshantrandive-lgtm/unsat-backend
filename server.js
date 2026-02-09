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

/* ================= HELPERS ================= */

/**
 * In Shared Drives, the DRIVE itself is the root.
 * No folder lookup is needed.
 */
function getDriveRootId() {
  return process.env.SHARED_DRIVE_ID;
}

/**
 * Get or create a school folder directly under Shared Drive
 */
async function getOrCreateSchoolFolder(schoolName) {
  const res = await drive.files.list({
    corpora: "drive",
    driveId: process.env.SHARED_DRIVE_ID,
    q: `name='${schoolName}' and mimeType='application/vnd.google-apps.folder'`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (res.data.files.length) {
    return res.data.files[0].id;
  }

  const folder = await drive.files.create({
    resource: {
      name: schoolName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [process.env.SHARED_DRIVE_ID]
    },
    supportsAllDrives: true
  });

  return folder.data.id;
}

/**
 * Upload JSON file (overwrite-safe)
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
    res.json({
      success: true,
      message: "Shared Drive root ready",
      driveId: process.env.SHARED_DRIVE_ID
    });
  } catch (e) {
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
    const schoolFolderId = await getOrCreateSchoolFolder(schoolName);

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
    const folders = await drive.files.list({
      corpora: "drive",
      driveId: process.env.SHARED_DRIVE_ID,
      q: `mimeType='application/vnd.google-apps.folder'`,
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
    const schoolFolderId = await getOrCreateSchoolFolder(req.params.schoolName);
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
