import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/* ================= GOOGLE AUTH ================= */

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/drive"]
});

const drive = google.drive({ version: "v3", auth });

const ROOT_FOLDER_NAME = "UNSAT-SCHOOLS";

/* ================= HELPERS ================= */

async function getRootFolderId() {
  const res = await drive.files.list({
    q: `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (!res.data.files.length) {
    throw new Error("Root folder NOT found or not shared");
  }

  return res.data.files[0].id;
}

async function getOrCreateFolder(name, parentId) {
  const res = await drive.files.list({
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

async function uploadJson(parentId, fileName, data) {
  const existing = await drive.files.list({
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

async function readJson(parentId, fileName) {
  const res = await drive.files.list({
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
    res.json({ success: true, rootId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/schools/save", async (req, res) => {
  const { schoolName, students } = req.body;

  try {
    const rootId = await getRootFolderId();
    const schoolFolderId = await getOrCreateFolder(schoolName, rootId);

    await uploadJson(schoolFolderId, "students.json", students);

    res.json({ success: true });
  } catch (e) {
    console.error("SAVE ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/schools", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    const folders = await drive.files.list({
      q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(name)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    res.json(folders.data.files.map(f => f.name));
  } catch {
    res.json([]);
  }
});

app.get("/schools/:schoolName", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    const schoolFolderId = await getOrCreateFolder(req.params.schoolName, rootId);
    const students = await readJson(schoolFolderId, "students.json");
    res.json(students);
  } catch {
    res.json([]);
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
