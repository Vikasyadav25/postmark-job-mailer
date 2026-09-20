// Used only by the local preview server. Never include this file in Apps Script.
window.POSTMARK_DEMO = (() => {
  const data = {
    email: "alex.morgan@example.com",
    template: {
      name: "Alex Morgan",
      subject: "Application for {{role}} — {{name}}",
      body: "Dear Hiring Team,\n\nI am writing to express my interest in {{role}} at {{company}}. I would welcome the opportunity to discuss how my skills and experience could contribute to your team.\n\nPlease find my resume attached for your consideration. Thank you for your time. I look forward to hearing from you.\n\nBest regards,\n{{name}}",
    },
    resume: { name: "Alex_Morgan_Resume.pdf", size: 184320, version: "demo" },
    history: [],
    todayCount: 0,
    dailyLimit: 25,
  };
  return {
    async call(method, input) {
      if (method === "getAppState") return structuredClone(data);
      if (method === "saveTemplate") {
        data.template = input;
        return structuredClone(input);
      }
      if (method === "uploadResume") {
        if (!atob(input.base64).startsWith("%PDF-"))
          throw new Error("Choose a valid PDF file.");
        data.resume = {
          name: input.name,
          size: atob(input.base64).length,
          version: "demo",
        };
        return {
          resume: structuredClone(data.resume),
          warning: "Preview only: this file was not uploaded to Google Drive.",
        };
      }
      if (method === "removeResume") {
        data.resume = null;
        return true;
      }
      if (method === "prepareDraft") {
        if (!data.resume)
          throw new Error("Upload a PDF resume in Settings first.");
        if (!input.subject.trim() || !input.body.trim())
          throw new Error("Enter a subject and message.");
        return {
          ...input,
          from: data.email,
          id: "demo",
          resume: structuredClone(data.resume),
        };
      }
      throw new Error("Email sending is disabled in the local preview.");
    },
  };
})();
