const form = document.getElementById("register-form");
const statusEl = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.className = "status";
  statusEl.textContent = "Submitting…";

  const payload = {
    fullName: form.fullName.value,
    email: form.email.value,
    phone: form.phone.value,
  };

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Registration failed.");
    }
    statusEl.className = "status ok";
    statusEl.textContent = data.message;
    form.reset();
  } catch (error) {
    statusEl.className = "status err";
    statusEl.textContent = error.message;
  }
});
