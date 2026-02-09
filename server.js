import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/* ================= GOOGLE AUTH ================= */

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  process.exit(1);
}

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
    fields: "files(id)"
  });

  if (!res.data.files.length) {
    throw new Error("Root folder NOT found in Google Drive");
  }

  return res.data.files[0].id;
}

async function getOrCreateFolder(name, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder'`,
    fields: "files(id)"
  });

  if (res.data.files.length) {
    return res.data.files[0].id;
  }

  const folder = await drive.files.create({
    resource: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    }
  });

  return folder.data.id;
}

async function uploadJson(parentId, fileName, data) {
  // delete old file if exists
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name='${fileName}'`,
    fields: "files(id)"
  });

  if (existing.data.files.length) {
    await drive.files.delete({
      fileId: existing.data.files[0].id
    });
  }

  // upload new file
  await drive.files.create({
    resource: {
      name: fileName,
      parents: [parentId]
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(data, null, 2)
    }
  });
}

async function readJson(parentId, fileName) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${fileName}'`,
    fields: "files(id)"
  });

  if (!res.data.files.length) return [];

  const fileId = res.data.files[0].id;
  const file = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "json" }
  );

  return file.data;
}

/* ================= TEST ROUTE ================= */

app.get("/drive-test", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    res.json({
      success: true,
      message: "Google Drive connected",
      rootFolderId: rootId
    });
  } catch (err) {
    console.error("DRIVE TEST ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* ================= APIs ================= */

app.post("/schools/save", async (req, res) => {
  const { schoolName, students } = req.body;

  console.log("SAVE REQUEST:", schoolName);

  if (!schoolName || !Array.isArray(students)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const rootId = await getRootFolderId();
    const schoolFolderId = await getOrCreateFolder(
      schoolName,
      rootId
    );

    await uploadJson(schoolFolderId, "students.json", students);
    await uploadJson(schoolFolderId, "meta.json", {
      schoolName,
      uploadedAt: new Date().toISOString()
    });

    console.log("SAVE SUCCESS:", schoolName);
    res.json({ success: true });
  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/schools", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    const folders = await drive.files.list({
      q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(name)"
    });

    res.json(folders.data.files.map((f) => f.name));
  } catch (err) {
    console.error("LIST ERROR:", err);
    res.status(500).json([]);
  }
});

app.get("/schools/:schoolName", async (req, res) => {
  try {
    const rootId = await getRootFolderId();
    const schoolFolderId = await getOrCreateFolder(
      req.params.schoolName,
      rootId
    );

    const students = await readJson(
      schoolFolderId,
      "students.json"
    );

    res.json(students);
  } catch (err) {
    console.error("LOAD ERROR:", err);
    res.status(500).json([]);
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
