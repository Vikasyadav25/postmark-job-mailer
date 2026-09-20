import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";

const source = readFileSync(new URL("../Code.gs", import.meta.url), "utf8");
const owner = "owner@gmail.com";
const pdf = Buffer.from("%PDF-1.7\nTest resume bytes\n%%EOF");
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");
function harness() {
  const store = new Map();
  const cache = new Map();
  const files = new Map();
  const legacy = new Map();
  const userStores = new Map([[owner, store]]);
  const userCaches = new Map([[owner, cache]]);
  const bucket = (map, email) => {
    if (!map.has(email)) map.set(email, new Map());
    return map.get(email);
  };
  const control = {
    active: owner,
    effective: owner,
    sent: [],
    sendError: false,
    downloadStatus: 200,
    locked: false,
    lockedUsers: new Set(),
    failWriteAfterSend: false,
  };
  const asBuffer = (data) =>
    Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.from(data)
        : Buffer.from(data || "", "utf8");
  const blob = (data, type, name) => ({
    getBytes: () => [...asBuffer(data)],
    type,
    name,
  });
  const propertiesFor = (store) => ({
    getProperty: (key) => store.get(key) ?? null,
    setProperty: (key, value) => {
      if (
        control.failWriteAfterSend &&
        key.startsWith("send:") &&
        control.sent.length
      )
        throw new Error("Storage unavailable");
      store.set(key, value);
    },
    deleteProperty: (key) => store.delete(key),
    getProperties: () => Object.fromEntries(store),
  });
  const context = vm.createContext({
    Session: {
      getActiveUser: () => ({ getEmail: () => control.active }),
      getEffectiveUser: () => ({ getEmail: () => control.effective }),
    },
    PropertiesService: {
      getUserProperties: () =>
        propertiesFor(bucket(userStores, control.effective)),
      getScriptProperties: () => propertiesFor(legacy),
    },
    CacheService: {
      getUserCache: () => {
        const cache = bucket(userCaches, control.effective);
        return {
          put: (key, value) => cache.set(key, value),
          get: (key) => cache.get(key) ?? null,
          remove: (key) => cache.delete(key),
        };
      },
    },
    LockService: {
      getUserLock: () => ({
        tryLock: () =>
          !control.locked && !control.lockedUsers.has(control.effective),
        releaseLock: () => {},
      }),
    },
    Utilities: {
      getUuid: randomUUID,
      newBlob: blob,
      Charset: { UTF_8: "utf8" },
      DigestAlgorithm: { MD5: "md5" },
      base64Encode: (data) => asBuffer(data).toString("base64"),
      base64EncodeWebSafe: (data) => asBuffer(data).toString("base64url"),
      base64Decode: (data) => [...Buffer.from(data, "base64")],
      computeDigest: (_, bytes) => [
        ...createHash("md5").update(asBuffer(bytes)).digest(),
      ],
    },
    Drive: {
      Files: {
        create: (meta, data) => {
          const id = randomUUID();
          const bytes = Buffer.from(data.getBytes());
          const file = {
            id,
            name: meta.name,
            size: bytes.length,
            md5Checksum: md5(bytes),
            bytes,
            trashed: false,
          };
          files.set(id, file);
          return file;
        },
        get: (id) => {
          if (!files.has(id)) throw new Error("Missing file");
          return files.get(id);
        },
        update: (meta, id) => {
          if (!files.has(id)) throw new Error("Missing file");
          Object.assign(files.get(id), meta);
        },
      },
    },
    ScriptApp: { getOAuthToken: () => "SERVER-ONLY-TOKEN" },
    UrlFetchApp: {
      fetch: (url) => {
        const id = url.split("/").at(-1).split("?")[0];
        return {
          getResponseCode: () => control.downloadStatus,
          getBlob: () => blob(control.downloadBytes || files.get(id).bytes),
        };
      },
    },
    Gmail: {
      Users: {
        Messages: {
          send: (message, user) => {
            control.sent.push({ ...message, user, actor: control.effective });
            if (control.sendError) throw new Error("Network timeout");
            return { id: "gmail-message-123" };
          },
        },
      },
    },
  });
  vm.runInContext(source, context);
  function ready() {
    context.setup();
    context.saveTemplate({
      name: "Alex Morgan",
      subject: "Application for {{role}} — {{name}}",
      body: "Hello {{company}},\nI am applying for {{role}}.\n{{name}}",
    });
    context.uploadResume({
      name: "Alex_Resume.pdf",
      base64: pdf.toString("base64"),
    });
  }
  const draft = (overrides) =>
    context.prepareDraft({
      to: "hr@example.com",
      subject: "Application — Designer",
      body: "Hello,\nHere is my resume. धन्यवाद",
      ...overrides,
    });
  return {
    context,
    store,
    cache,
    files,
    control,
    ready,
    draft,
    legacy,
    userStores,
    userCaches,
    asUser(email) {
      control.active = email;
      control.effective = email;
    },
  };
}

test("all application endpoints reject anonymous callers", () => {
  const h = harness();
  h.asUser("");
  for (const method of [
    "getAppState",
    "saveTemplate",
    "uploadResume",
    "removeResume",
    "prepareDraft",
    "sendDraft",
    "doGet",
  ]) {
    assert.throws(() => h.context[method]({}), /Access denied/, method);
  }
});
test("setup requires matching active and effective identities", () => {
  const h = harness();
  h.control.active = "stranger@gmail.com";
  assert.throws(() => h.context.setup(), /Access denied/);
  assert.equal(h.store.size, 0);
});
test("identity checks fail closed for anonymous sessions and mismatched execution identities", () => {
  const h = harness();
  h.ready();
  for (const identity of ["stranger@gmail.com", ""]) {
    h.control.active = identity;
    for (const method of [
      "getAppState",
      "saveTemplate",
      "uploadResume",
      "removeResume",
      "prepareDraft",
      "sendDraft",
    ])
      assert.throws(() => h.context[method]({}), /Access denied/);
  }
  h.control.active = owner;
  h.control.effective = "stranger@gmail.com";
  assert.throws(() => h.context.getAppState(), /Access denied/);
});
test("new signed-in users can start without owner setup", () => {
  const h = harness();
  h.asUser("second@gmail.com");
  const state = h.context.getAppState();
  assert.equal(state.email, "second@gmail.com");
  assert.equal(state.template.name, "");
  assert.equal(state.resume, null);
  assert.equal(state.history.length, 0);
});

test("two users have isolated templates, resumes, drafts, send identities and history", () => {
  const h = harness();
  h.ready();
  const first = h.context.getAppState();
  const firstDraft = h.draft();
  h.asUser("partner@gmail.com");
  assert.equal(h.context.getAppState().resume, null);
  assert.equal(h.context.getAppState().template.name, "");
  assert.throws(() => h.context.sendDraft(firstDraft.id), /expired/);
  h.context.saveTemplate({
    name: "Partner",
    subject: "My application",
    body: "My introduction",
  });
  const secondResume = h.context.uploadResume({
    name: "Partner.pdf",
    base64: pdf.toString("base64"),
  }).resume;
  const secondDraft = h.draft();
  h.context.sendDraft(secondDraft.id);
  assert.equal(h.control.sent[0].actor, "partner@gmail.com");
  assert.match(
    Buffer.from(h.control.sent[0].raw, "base64url").toString(),
    /From: partner@gmail.com/,
  );
  assert.equal(h.context.getAppState().history.length, 1);
  h.context.removeResume();
  assert.equal(h.files.get(secondResume.id).trashed, true);
  assert.equal(h.files.get(first.resume.id).trashed, false);
  h.asUser(owner);
  assert.equal(h.context.getAppState().template.name, "Alex Morgan");
  assert.equal(h.context.getAppState().resume.id, first.resume.id);
  assert.equal(h.context.getAppState().history.length, 0);
  assert.throws(() => h.context.sendDraft(secondDraft.id), /expired/);
  h.context.sendDraft(firstDraft.id);
  assert.equal(h.control.sent[1].actor, owner);
  h.asUser("partner@gmail.com");
  assert.equal(h.context.getAppState().template.name, "Partner");
  assert.equal(h.context.getAppState().history.length, 1);
});

test("daily limits and locks are independent for each user", () => {
  const h = harness();
  h.ready();
  for (let i = 0; i < 25; i++)
    h.store.set(
      "send:" + randomUUID(),
      JSON.stringify({ at: Date.now(), status: "sent" }),
    );
  h.control.lockedUsers.add(owner);
  h.asUser("partner@gmail.com");
  h.ready();
  assert.equal(h.context.getAppState().todayCount, 0);
  assert.equal(h.context.sendDraft(h.draft().id).status, "sent");
  h.asUser(owner);
  assert.throws(() => h.context.getAppState(), /Another action/);
  h.control.lockedUsers.clear();
  assert.equal(h.context.getAppState().todayCount, 25);
});

test("legacy data migrates only into the original owner's user storage", () => {
  const h = harness();
  h.legacy.set("owner", owner);
  h.legacy.set(
    "template",
    JSON.stringify({
      name: "Legacy owner",
      subject: "Legacy",
      body: "Private message",
    }),
  );
  h.legacy.set(
    "resume",
    JSON.stringify({ id: "private-file", name: "Private.pdf" }),
  );
  h.legacy.set(
    "send:old",
    JSON.stringify({
      at: Date.now(),
      to: "private@example.com",
      status: "sent",
    }),
  );
  h.asUser("partner@gmail.com");
  const other = h.context.getAppState();
  assert.equal(other.template.name, "");
  assert.equal(other.resume, null);
  assert.equal(other.history.length, 0);
  assert.equal(h.legacy.size, 4);
  h.asUser(owner);
  const migrated = h.context.getAppState();
  assert.equal(migrated.template.name, "Legacy owner");
  assert.equal(migrated.resume.id, "private-file");
  assert.equal(migrated.history.length, 1);
  assert.equal(h.legacy.size, 0);
  h.asUser("partner@gmail.com");
  assert.equal(h.context.getAppState().history.length, 0);
});

test("legacy migration preserves newer user settings", () => {
  const h = harness();
  h.ready();
  h.legacy.set("owner", owner);
  h.legacy.set("template", JSON.stringify({ name: "Stale" }));
  assert.equal(h.context.getAppState().template.name, "Alex Morgan");
  assert.equal(h.legacy.size, 0);
});

test("send verifies snapshot sender even if a foreign draft enters the user cache", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  const cached = JSON.parse(h.cache.get("draft:" + draft.id));
  cached.from = "someone-else@gmail.com";
  h.cache.set("draft:" + draft.id, JSON.stringify(cached));
  assert.throws(() => h.context.sendDraft(draft.id), /another account/);
  assert.equal(h.control.sent.length, 0);
});

test("saved state contains settings and no OAuth token", () => {
  const h = harness();
  h.ready();
  const state = h.context.getAppState();
  assert.equal(state.email, owner);
  assert.equal(state.template.name, "Alex Morgan");
  assert.equal(state.resume.name, "Alex_Resume.pdf");
  assert.equal(state.todayCount, 0);
  assert.ok(!JSON.stringify(state).includes("TOKEN"));
});
test("rejects header injection, multiple recipients and malformed email", () => {
  const h = harness();
  h.ready();
  for (const to of [
    "hr@example.com\r\nBcc: thief@example.com",
    "a@b.com,c@d.com",
    "Person <hr@example.com>",
    "hr@example",
    "x..y@example.com",
    "x@-bad.com",
    "x@ok_.com",
  ]) {
    assert.throws(() => h.draft({ to }), /Recipient|recipient/);
  }
  assert.throws(
    () => h.draft({ subject: "Hi\r\nBcc: x@y.com" }),
    /single line/,
  );
});
test("accepts plus addressing and a single normal email", () => {
  const h = harness();
  h.ready();
  assert.equal(
    h.draft({ to: "jobs+india@careers.example.co.in" }).to,
    "jobs+india@careers.example.co.in",
  );
});
test("requires name and resume before review", () => {
  const h = harness();
  h.context.setup();
  assert.throws(() => h.draft(), /name/);
  h.context.saveTemplate({
    name: "Alex",
    subject: "Application",
    body: "Hello",
  });
  assert.throws(() => h.draft(), /resume/);
});
test("templates reject unsupported placeholders and oversize property payloads", () => {
  const h = harness();
  h.ready();
  assert.throws(
    () =>
      h.context.saveTemplate({
        name: "Alex",
        subject: "Hello {{wrong}}",
        body: "Test",
      }),
    /placeholders/,
  );
  assert.throws(
    () =>
      h.context.saveTemplate({
        name: "Alex",
        subject: "Hello",
        body: "語".repeat(3000),
      }),
    /shorten/,
  );
  assert.equal(
    h.context.saveTemplate({
      name: "Alex",
      subject: "{{ role }}",
      body: "{{company}}\n{{ name }}",
    }).name,
    "Alex",
  );
});
test("resume validation rejects fake PDFs, oversize and malicious filenames", () => {
  const h = harness();
  h.ready();
  for (const input of [
    { name: "resume.docx", base64: pdf.toString("base64") },
    { name: "resume.pdf", base64: Buffer.from("not a PDF").toString("base64") },
    { name: "resume.pdf\r\nx", base64: pdf.toString("base64") },
    { name: "resume.pdf", base64: "!invalid!" },
    { name: "resume.pdf", base64: "A".repeat(7 * 1024 * 1024) },
  ])
    assert.throws(() => h.context.uploadResume(input));
});
test("resume replacement trashes only previous app-created copy; removal clears reference", () => {
  const h = harness();
  h.ready();
  const first = h.context.getAppState().resume;
  const second = h.context.uploadResume({
    name: 'New "resume".pdf',
    base64: pdf.toString("base64"),
  }).resume;
  assert.equal(h.files.get(first.id).trashed, true);
  assert.equal(second.name, "New _resume_.pdf");
  h.context.removeResume();
  assert.equal(h.files.get(second.id).trashed, true);
  assert.equal(h.context.getAppState().resume, null);
});
test("prepare never sends and rejects unresolved placeholders", () => {
  const h = harness();
  h.ready();
  h.draft();
  assert.equal(h.control.sent.length, 0);
  assert.throws(() => h.draft({ body: "Hello {{name}}" }), /placeholders/);
});
test("send builds correct UTF-8 MIME and attaches exact PDF bytes", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  const result = h.context.sendDraft(draft.id);
  assert.equal(result.status, "sent");
  assert.equal(h.control.sent[0].user, "me");
  const mime = Buffer.from(h.control.sent[0].raw, "base64url").toString("utf8");
  assert.match(mime, /From: owner@gmail.com\r\nTo: hr@example.com/);
  assert.ok(mime.includes(Buffer.from(draft.subject).toString("base64")));
  assert.ok(mime.includes(Buffer.from(draft.body).toString("base64")));
  assert.ok(mime.includes(pdf.toString("base64")));
  assert.match(mime, /filename="Alex_Resume.pdf"/);
  assert.equal(h.context.getAppState().todayCount, 1);
});
test("long Unicode subjects use RFC-sized encoded words", () => {
  const h = harness();
  h.ready();
  const draft = h.draft({ subject: "職".repeat(150) });
  h.context.sendDraft(draft.id);
  const mime = Buffer.from(h.control.sent[0].raw, "base64url").toString();
  const words = mime.match(/=\?UTF-8\?B\?[^?]+\?=/g);
  assert.ok(words.length > 1);
  assert.ok(words.every((word) => word.length <= 75));
  assert.equal(
    words
      .map((word) => Buffer.from(word.slice(10, -2), "base64").toString())
      .join(""),
    draft.subject,
  );
});
test("changing returned review fields cannot alter cached send snapshot", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  draft.to = "attacker@example.com";
  draft.body = "Changed";
  h.context.sendDraft(draft.id);
  const mime = Buffer.from(h.control.sent[0].raw, "base64url").toString();
  assert.match(mime, /To: hr@example.com/);
  assert.ok(!mime.includes("attacker@example.com"));
});
test("double-send and replay after cache loss submit only once", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  const first = h.context.sendDraft(draft.id);
  h.cache.clear();
  const second = h.context.sendDraft(draft.id);
  assert.equal(h.control.sent.length, 1);
  assert.equal(first.messageId, second.messageId);
});
test("Gmail timeout persists unknown status and never automatically retries", () => {
  const h = harness();
  h.ready();
  h.control.sendError = true;
  const draft = h.draft();
  assert.equal(h.context.sendDraft(draft.id).status, "unknown");
  h.control.sendError = false;
  assert.equal(h.context.sendDraft(draft.id).status, "unknown");
  assert.equal(h.control.sent.length, 1);
  assert.equal(h.context.getAppState().todayCount, 1);
});
test("post-send storage failure retains pre-send guard", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  h.control.failWriteAfterSend = true;
  assert.throws(() => h.context.sendDraft(draft.id), /Storage unavailable/);
  h.control.failWriteAfterSend = false;
  assert.equal(h.context.sendDraft(draft.id).status, "unknown");
  assert.equal(h.control.sent.length, 1);
});
test("missing and expired reviews never send", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  const cached = JSON.parse(h.cache.get("draft:" + draft.id));
  cached.expiresAt = 0;
  h.cache.set("draft:" + draft.id, JSON.stringify(cached));
  assert.throws(() => h.context.sendDraft(draft.id), /expired/);
  h.cache.clear();
  assert.throws(() => h.context.sendDraft(draft.id), /expired/);
  assert.equal(h.control.sent.length, 0);
});
test("resume replacement or deletion invalidates previous review", () => {
  for (const action of ["replace", "remove"]) {
    const h = harness();
    h.ready();
    const draft = h.draft();
    if (action === "replace")
      h.context.uploadResume({
        name: "new.pdf",
        base64: pdf.toString("base64"),
      });
    else h.context.removeResume();
    assert.throws(() => h.context.sendDraft(draft.id), /resume changed/);
    assert.equal(h.control.sent.length, 0);
  }
});
test("Drive modification and download integrity mismatch prevent sending", () => {
  for (const action of ["metadata", "download", "http"]) {
    const h = harness();
    h.ready();
    const draft = h.draft();
    if (action === "metadata")
      h.files.get(draft.resume.id).md5Checksum = "changed";
    if (action === "download")
      h.control.downloadBytes = Buffer.from("%PDF-altered");
    if (action === "http") h.control.downloadStatus = 403;
    assert.throws(() => h.context.sendDraft(draft.id), /resume|Resume/);
    assert.equal(h.control.sent.length, 0);
    assert.equal(h.store.has("send:" + draft.id), false);
  }
});
test("rolling daily cap counts uncertain attempts and blocks attempt 26", () => {
  const h = harness();
  h.ready();
  for (let i = 0; i < 25; i++)
    h.store.set(
      "send:" + randomUUID(),
      JSON.stringify({ at: Date.now() - i * 1000, status: "unknown" }),
    );
  const draft = h.draft();
  assert.throws(() => h.context.sendDraft(draft.id), /25 send attempts/);
  assert.equal(h.control.sent.length, 0);
});
test("history prunes data after 7 days and returns only latest 10 records", () => {
  const h = harness();
  h.ready();
  h.store.set("send:old", JSON.stringify({ at: Date.now() - 8 * 86400000 }));
  for (let i = 0; i < 12; i++)
    h.store.set(
      "send:" + i,
      JSON.stringify({ at: Date.now() - i * 1000, id: i }),
    );
  const state = h.context.getAppState();
  assert.equal(state.history.length, 10);
  assert.equal(state.history[0].id, 0);
  assert.equal(h.store.has("send:old"), false);
  assert.equal(state.todayCount, 12);
});
test("busy lock stops sending without calling Gmail", () => {
  const h = harness();
  h.ready();
  const draft = h.draft();
  h.control.locked = true;
  assert.throws(() => h.context.sendDraft(draft.id), /Another action/);
  assert.equal(h.control.sent.length, 0);
});
test("manifest requires Google login and executes as the accessing user", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../appsscript.json", import.meta.url)),
  );
  assert.equal(manifest.webapp.access, "ANYONE");
  assert.equal(manifest.webapp.executeAs, "USER_ACCESSING");
  assert.ok(
    manifest.oauthScopes.includes("https://www.googleapis.com/auth/gmail.send"),
  );
  assert.ok(
    manifest.oauthScopes.includes("https://www.googleapis.com/auth/drive.file"),
  );
  assert.ok(
    !manifest.oauthScopes.some(
      (scope) =>
        scope === "https://mail.google.com/" || scope.endsWith("/auth/drive"),
    ),
  );
});
test("client and preview JavaScript parse successfully", () => {
  const client = readFileSync(
    new URL("../Client.html", import.meta.url),
    "utf8",
  )
    .replace(/^<script>\s*/, "")
    .replace(/<\/script>\s*$/, "");
  assert.doesNotThrow(() => new vm.Script(client));
  assert.doesNotThrow(
    () =>
      new vm.Script(
        readFileSync(
          new URL("../scripts/preview-demo.js", import.meta.url),
          "utf8",
        ),
      ),
  );
});
