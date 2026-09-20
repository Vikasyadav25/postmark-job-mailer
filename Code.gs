const APP = Object.freeze({
  maxPdfBytes: 5 * 1024 * 1024,
  dailyLimit: 25,
  retentionDays: 7,
});

// Optional editor check. Each visitor authorizes their own account on first use.
function setup() {
  assertUser_();
  return "Ready. Deploy as User accessing the web app, with access for Anyone with Google account.";
}

function doGet() {
  assertUser_();
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Postmark · Your next chapter")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
}

function include_(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

function assertUser_() {
  const active = Session.getActiveUser().getEmail().toLowerCase();
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  // Fail closed if deployed as the developer instead of the signed-in visitor.
  if (!active || !effective || active !== effective) {
    throw new Error(
      "Access denied. Sign in with Google. This app must run as User accessing the web app.",
    );
  }
  return active;
}

// Preserve data from the previous single-owner version without exposing it to visitors.
// Call only inside the current user's lock after authentication.
function migrateLegacyData_(email) {
  const legacy = PropertiesService.getScriptProperties();
  if (legacy.getProperty("owner") !== email) return;
  const user = PropertiesService.getUserProperties();
  const all = legacy.getProperties();
  Object.keys(all)
    .filter(function (key) {
      return key === "template" || key === "resume" || key.startsWith("send:");
    })
    .forEach(function (key) {
      if (user.getProperty(key) === null) user.setProperty(key, all[key]);
      legacy.deleteProperty(key);
    });
  legacy.deleteProperty("owner");
}

function withLock_(fn) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000))
    throw new Error("Another action is running. Please wait and try again.");
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function defaults_() {
  return {
    name: "",
    subject: "Application for {{role}} — {{name}}",
    body: "Dear Hiring Team,\n\nI am writing to express my interest in {{role}} at {{company}}. I would welcome the opportunity to discuss how my skills and experience could contribute to your team.\n\nPlease find my resume attached for your consideration. Thank you for your time. I look forward to hearing from you.\n\nBest regards,\n{{name}}",
  };
}

function settings_() {
  const props = PropertiesService.getUserProperties();
  return {
    template:
      JSON.parse(props.getProperty("template") || "null") || defaults_(),
    resume: JSON.parse(props.getProperty("resume") || "null"),
  };
}

function getAppState() {
  const email = assertUser_();
  return withLock_(function () {
    migrateLegacyData_(email);
    const history = history_();
    const config = settings_();
    return {
      email: email,
      template: config.template,
      resume: config.resume,
      history: history.slice(0, 10),
      dailyLimit: APP.dailyLimit,
      todayCount: history.filter(function (item) {
        return item.at >= Date.now() - 86400000;
      }).length,
    };
  });
}

function text_(value, label, max, optional) {
  if (typeof value !== "string") throw new Error(label + " must be text.");
  const result = value.trim();
  if ((!optional && !result) || result.length > max || /\u0000/.test(result)) {
    throw new Error(
      label + " is missing or too long (maximum " + max + " characters).",
    );
  }
  return result;
}

function header_(value, label, max) {
  const result = text_(value, label, max, false);
  if (/[\r\n\x00-\x1f\x7f]/.test(result))
    throw new Error(label + " must be a single line.");
  return result;
}

function email_(value) {
  const email = header_(value, "Recipient", 254);
  if (
    !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      email,
    ) ||
    email.split("@")[0].length > 64 ||
    email.startsWith(".") ||
    email.includes("..") ||
    email.includes(".@")
  ) {
    throw new Error(
      "Enter one valid recipient email address, without a display name.",
    );
  }
  return email;
}

function saveTemplate(input) {
  assertUser_();
  const template = {
    name: header_(input.name, "Your name", 100),
    subject: header_(input.subject, "Subject template", 200),
    body: text_(input.body, "Message template", 5000, false),
  };
  [template.subject, template.body].forEach(function (value) {
    const tokens = value.match(/{{[^{}]*}}/g) || [];
    if (
      tokens.some(function (token) {
        return !/^{{\s*(name|company|role)\s*}}$/.test(token);
      })
    ) {
      throw new Error(
        "Use only {{name}}, {{company}}, and {{role}} placeholders.",
      );
    }
  });
  const serialized = JSON.stringify(template);
  if (Utilities.newBlob(serialized).getBytes().length > 8000)
    throw new Error("Please shorten your template to fit secure storage.");
  return withLock_(function () {
    PropertiesService.getUserProperties().setProperty("template", serialized);
    return template;
  });
}

function uploadResume(input) {
  assertUser_();
  const name = header_(input.name, "Resume filename", 120);
  if (
    !/\.pdf$/i.test(name) ||
    typeof input.base64 !== "string" ||
    input.base64.length > Math.ceil(APP.maxPdfBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
  )
    throw new Error("Choose a PDF resume no larger than 5 MB.");
  const bytes = Utilities.base64Decode(input.base64);
  if (
    !bytes.length ||
    bytes.length > APP.maxPdfBytes ||
    bytes
      .slice(0, 5)
      .map(function (b) {
        return String.fromCharCode(b);
      })
      .join("") !== "%PDF-"
  ) {
    throw new Error("This file is not a valid PDF, or exceeds 5 MB.");
  }
  return withLock_(function () {
    const old = settings_().resume;
    const safeName = name.replace(/[^A-Za-z0-9 ._()-]/g, "_");
    const blob = Utilities.newBlob(bytes, "application/pdf", safeName);
    const file = Drive.Files.create(
      { name: safeName, mimeType: "application/pdf" },
      blob,
      { fields: "id,name,size,md5Checksum" },
    );
    const resume = {
      id: file.id,
      name: file.name,
      size: Number(file.size),
      checksum: file.md5Checksum,
      version: Utilities.getUuid(),
    };
    PropertiesService.getUserProperties().setProperty(
      "resume",
      JSON.stringify(resume),
    );
    let warning = "";
    if (old) {
      try {
        Drive.Files.update({ trashed: true }, old.id);
      } catch (error) {
        warning =
          "New resume saved. The old copy could not be moved to Drive trash; you can remove it manually.";
      }
    }
    return { resume: resume, warning: warning };
  });
}

function removeResume() {
  assertUser_();
  return withLock_(function () {
    const resume = settings_().resume;
    if (resume) Drive.Files.update({ trashed: true }, resume.id);
    PropertiesService.getUserProperties().deleteProperty("resume");
    return true;
  });
}

function prepareDraft(input) {
  const email = assertUser_();
  return withLock_(function () {
    const config = settings_();
    if (!config.template.name)
      throw new Error("Save your name and email template in Settings first.");
    if (!config.resume)
      throw new Error("Upload your PDF resume in Settings first.");
    const draft = {
      id: Utilities.getUuid(),
      from: email,
      to: email_(input.to),
      subject: header_(input.subject, "Subject", 200),
      body: text_(input.body, "Message", 10000, false),
      resume: config.resume,
      expiresAt: Date.now() + 600000,
    };
    if (/{{[^{}]*}}/.test(draft.subject + draft.body))
      throw new Error("Replace all template placeholders before reviewing.");
    CacheService.getUserCache().put(
      "draft:" + draft.id,
      JSON.stringify(draft),
      600,
    );
    return draft;
  });
}

function history_() {
  const props = PropertiesService.getUserProperties();
  const all = props.getProperties();
  const cutoff = Date.now() - APP.retentionDays * 86400000;
  const entries = [];
  Object.keys(all)
    .filter(function (key) {
      return key.startsWith("send:");
    })
    .forEach(function (key) {
      const entry = JSON.parse(all[key]);
      if (entry.at < cutoff) props.deleteProperty(key);
      else entries.push(entry);
    });
  return entries.sort(function (a, b) {
    return b.at - a.at;
  });
}

function wrapBase64_(value) {
  return value.match(/.{1,76}/g).join("\r\n");
}

function mime_(draft, bytes) {
  const boundary = "postmark_" + Utilities.getUuid();
  // Split encoded words to respect RFC 2047's 75-character limit, including Unicode subjects.
  const subjectChunks = Array.from(draft.subject).reduce(function (
    chunks,
    char,
  ) {
    if (
      !chunks.length ||
      Utilities.newBlob(chunks[chunks.length - 1] + char).getBytes().length > 42
    )
      chunks.push(char);
    else chunks[chunks.length - 1] += char;
    return chunks;
  }, []);
  const subject = subjectChunks
    .map(function (part) {
      return (
        "=?UTF-8?B?" +
        Utilities.base64Encode(part, Utilities.Charset.UTF_8) +
        "?="
      );
    })
    .join("\r\n ");
  return [
    "From: " + draft.from,
    "To: " + draft.to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64_(Utilities.base64Encode(draft.body, Utilities.Charset.UTF_8)),
    "",
    "--" + boundary,
    "Content-Type: application/pdf",
    'Content-Disposition: attachment; filename="' + draft.resume.name + '"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64_(Utilities.base64Encode(bytes)),
    "",
    "--" + boundary + "--",
    "",
  ].join("\r\n");
}

function sendDraft(id) {
  const email = assertUser_();
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error("Invalid review. Please review your email again.");
  return withLock_(function () {
    const props = PropertiesService.getUserProperties();
    const prior = props.getProperty("send:" + id);
    if (prior) return JSON.parse(prior); // Durable idempotency, including ambiguous outcomes.
    const cached = CacheService.getUserCache().get("draft:" + id);
    if (!cached)
      throw new Error(
        "Your review expired. Close it and review your email again.",
      );
    const draft = JSON.parse(cached);
    if (draft.from !== email)
      throw new Error(
        "This review belongs to another account. Please review again.",
      );
    if (draft.expiresAt < Date.now())
      throw new Error("Your review expired. Please review again.");
    const resume = settings_().resume;
    if (!resume || resume.version !== draft.resume.version)
      throw new Error(
        "Your resume changed. Close this review and review again.",
      );
    const history = history_();
    if (
      history.filter(function (entry) {
        return entry.at > Date.now() - 86400000;
      }).length >= APP.dailyLimit
    ) {
      throw new Error(
        "The personal safety limit is 25 send attempts per rolling 24 hours. Please try later.",
      );
    }
    const metadata = Drive.Files.get(resume.id, {
      fields: "md5Checksum,trashed,size",
    });
    if (
      metadata.trashed ||
      metadata.md5Checksum !== resume.checksum ||
      Number(metadata.size) > APP.maxPdfBytes
    ) {
      throw new Error(
        "Your saved resume changed in Drive. Upload it again before sending.",
      );
    }
    const response = UrlFetchApp.fetch(
      "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(resume.id) +
        "?alt=media",
      {
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      },
    );
    if (response.getResponseCode() !== 200)
      throw new Error(
        "Could not load the resume from Drive. No email was sent.",
      );
    const bytes = response.getBlob().getBytes();
    const checksum = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      bytes,
    )
      .map(function (byte) {
        return ("0" + (byte & 255).toString(16)).slice(-2);
      })
      .join("");
    if (checksum !== resume.checksum)
      throw new Error(
        "The resume changed while loading. Upload it again. No email was sent.",
      );
    const raw = Utilities.base64EncodeWebSafe(
      mime_(draft, bytes),
      Utilities.Charset.UTF_8,
    );
    const entry = {
      id: id,
      to: draft.to,
      subject: draft.subject,
      at: Date.now(),
      status: "unknown",
    };
    // Persist BEFORE Gmail. A timeout must never trigger an automatic second send.
    props.setProperty("send:" + id, JSON.stringify(entry));
    try {
      const sent = Gmail.Users.Messages.send({ raw: raw }, "me");
      if (sent && sent.id) {
        entry.status = "sent";
        entry.messageId = sent.id;
      }
    } catch (error) {
      // Do not expose provider payloads or retry an ambiguous mail submission.
    }
    props.setProperty("send:" + id, JSON.stringify(entry));
    CacheService.getUserCache().remove("draft:" + id);
    return entry;
  });
}
