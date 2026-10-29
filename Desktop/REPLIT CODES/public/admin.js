const loginView = document.getElementById("login-view");
const logView = document.getElementById("log-view");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const rows = document.getElementById("rows");
const stats = document.getElementById("stats");
const search = document.getElementById("search");
const logoutBtn = document.getElementById("logout");
const adminStatus = document.getElementById("admin-status");
const downloadPdfBtn = document.getElementById("download-pdf");

let students = [];

function getFilteredStudents() {
  const query = search.value.trim().toLowerCase();
  return students.filter((student) => {
    const haystack = `${student.fullName} ${student.email} ${student.phone}`.toLowerCase();
    return haystack.includes(query);
  });
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function render() {
  const filtered = getFilteredStudents();

  stats.textContent = `${filtered.length} of ${students.length} students`;

  if (!filtered.length) {
    rows.innerHTML = `<tr><td class="empty" colspan="5">No matching students yet.</td></tr>`;
    return;
  }

  rows.innerHTML = filtered
    .map(
      (student) => `
        <tr>
          <td>${escapeHtml(student.fullName)}</td>
          <td>${escapeHtml(student.email)}</td>
          <td>${escapeHtml(student.phone)}</td>
          <td>${escapeHtml(formatDate(student.registeredAt))}</td>
          <td><button class="delete-btn" type="button" data-student-id="${escapeHtml(student.id)}">Delete</button></td>
        </tr>`
    )
    .join("");
}

function pdfSafeText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfText(value) {
  return pdfSafeText(value).replace(/[\\()]/g, "\\$&");
}

function wrapPdfText(value, maxLength = 88) {
  const words = pdfSafeText(value).split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    if (word.length > maxLength) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      line = "";
      continue;
    }
    if (line && `${line} ${word}`.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function buildPdf(lines) {
  const encoder = new TextEncoder();
  const linesPerPage = 48;
  const pages = [];

  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  if (!pages.length) pages.push([]);

  const fontId = 3 + pages.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];

  pages.forEach((pageLines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const content = [
      "BT",
      "/F1 10 Tf",
      "50 744 Td",
      ...pageLines.flatMap((line, lineIndex) => [
        ...(lineIndex ? ["0 -14 Td"] : []),
        `(${escapePdfText(line)}) Tj`,
      ]),
      "ET",
    ].join("\n");

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

function downloadPdf() {
  const filtered = getFilteredStudents();
  const lines = [
    "Student Registration Log",
    `Exported: ${new Date().toISOString()}`,
    `Students: ${filtered.length}`,
    "",
  ];

  if (!filtered.length) {
    lines.push("No students to display.");
  } else {
    filtered.forEach((student, index) => {
      lines.push(
        ...wrapPdfText(`${index + 1}. ${student.fullName}`),
        ...wrapPdfText(`   Email: ${student.email}`),
        ...wrapPdfText(`   Phone: ${student.phone}`),
        ...wrapPdfText(`   Registered: ${student.registeredAt}`),
        ""
      );
    });
  }

  const blob = new Blob([buildPdf(lines)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "student-registration-log.pdf";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showLog() {
  loginView.classList.add("hidden");
  logView.classList.remove("hidden");
}

function showLogin() {
  logView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

async function loadStudents() {
  const response = await fetch("/api/admin/students");
  if (response.status === 401) {
    showLogin();
    return false;
  }
  const data = await response.json();
  students = data.students || [];
  showLog();
  render();
  return true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.className = "status";
  loginStatus.textContent = "Signing in…";
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginForm.username.value,
        password: loginForm.password.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Login failed.");
    loginStatus.textContent = "";
    loginForm.reset();
    await loadStudents();
  } catch (error) {
    loginStatus.className = "status err";
    loginStatus.textContent = error.message;
  }
});

search.addEventListener("input", render);
downloadPdfBtn.addEventListener("click", downloadPdf);

rows.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-student-id]");
  if (!button) return;

  button.disabled = true;
  adminStatus.className = "status";
  adminStatus.textContent = "Deleting student…";

  try {
    const response = await fetch(
      `/api/admin/students/${encodeURIComponent(button.dataset.studentId)}/delete`,
      { method: "POST" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Could not delete student (HTTP ${response.status}).`);
    }

    students = students.filter((student) => student.id !== button.dataset.studentId);
    render();
    adminStatus.className = "status ok";
    adminStatus.textContent = "Student registration deleted.";
  } catch (error) {
    adminStatus.className = "status err";
    adminStatus.textContent = error.message;
    button.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  students = [];
  showLogin();
});

loadStudents().catch(() => showLogin());
