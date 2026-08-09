/**
 * SMART RESIDENTS FRONTEND CONTROLLER
 * Rewired to the REAL Maoka Residence Apps Script backend (same
 * deployment your production index.html uses), instead of the
 * placeholder/demo URL and action names this file shipped with.
 *
 * Backend contract (confirmed from index.html):
 *   READS  -> JSONP:  SCRIPT_URL + '?action=<name>&...&callback=<cb>'
 *             (plain fetch() GET can't read the response — Apps
 *             Script doesn't send CORS headers, so JSONP is used
 *             instead, same as the rest of your app.)
 *   WRITES -> POST:   fetch(SCRIPT_URL, {method:'POST',
 *             headers:{'Content-Type':'text/plain'},
 *             body: JSON.stringify({ type: '<name>', ...fields })})
 *
 * `register` / `login` / `forgotPassword` need the Code.gs
 * additions from Code_auth_additions.gs to be deployed — see that
 * file for the paste-in instructions.
 */

// Live Google Apps Script Web App Endpoint URL (the real Maoka deployment)
const API_URL = "https://script.google.com/macros/s/AKfycbx_q1htW6jdqbXt9F2_l08jr7TzTcZw4i4t5CzFlf1JFDaJA4BD0qZVjq_8ak6xxYPf/exec";

/* ==========================================================================
   LOW-LEVEL API HELPERS (JSONP reads, fire-and-forget POST writes)
   ========================================================================== */

// GET + JSONP, for actions like 'browseProperties', 'announcements', 'register', 'login'
function apiRead(action, params) {
  return new Promise((resolve) => {
    if (!API_URL) { resolve({ success: false, message: "Backend URL not configured." }); return; }
    const cbName = "smartCB_" + action + "_" + Date.now();
    const qs = Object.keys(params || {}).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
    const scriptEl = document.createElement("script");

    window[cbName] = function (data) {
      resolve(data);
      delete window[cbName];
      scriptEl.remove();
    };
    scriptEl.src = API_URL + "?action=" + action + (qs ? "&" + qs : "") + "&callback=" + cbName;
    scriptEl.onerror = function () {
      delete window[cbName];
      scriptEl.remove();
      resolve({ success: false, message: "Network error. Please verify your Google Apps Script Web App URL." });
    };
    document.body.appendChild(scriptEl);
  });
}

// POST write, for actions like 'property', 'application', 'fault', 'notice', 'announcement'
async function apiWrite(type, payload) {
  if (!API_URL) return { success: false, message: "Backend URL not configured." };
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ type: type }, payload))
    });
    // Apps Script POST responses are typically unreadable cross-origin
    // (no CORS headers), so we treat "the request went out" as success —
    // same approach the rest of your app already uses (postToSheet()).
    return { success: true };
  } catch (err) {
    console.error(`API Error during action [${type}]:`, err);
    return { success: false, message: "Network error. Please verify your Google Apps Script Web App URL." };
  }
}

function refWithPrefix(prefix) {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ==========================================================================
   SESSION (landlord identity needed for publishing listings)
   ========================================================================== */

function getSession() {
  try { return JSON.parse(localStorage.getItem("maoka_session") || "null"); } catch (e) { return null; }
}
function saveSession(username, name, role) {
  try { localStorage.setItem("maoka_session", JSON.stringify({ username, name, role: role || "Landlord", loggedInAt: new Date().toISOString() })); } catch (e) {}
}

/**
 * Image Compression Routine
 * Compresses photo uploads to base64 prior to network transmission
 */
function compressFileToBase64(file, maxWidth = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

/* ==========================================================================
   EVENT HANDLERS & FORM CONTROLLERS
   ========================================================================== */

// Load active property listings automatically when page DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  fetchAndRenderListings();
});

/**
 * 1. Fetch & Display Active Property Listings
 *    Backend action: 'browseProperties' (matches index.html's marketplace)
 */
async function fetchAndRenderListings() {
  const container = document.getElementById("listingsContainer");
  if (!container) return;

  container.innerHTML = "<p>Loading active listings...</p>";

  const list = await apiRead("browseProperties", {});
  const items = Array.isArray(list) ? list : (list && Array.isArray(list.data) ? list.data : []);
  const active = items.filter(item => (item.status || "Active") === "Active");

  if (active.length > 0) {
    container.innerHTML = active.map(item => `
      <div class="property-card" id="listing-${item.ref || item.id || ""}">
        <img src="${item.photo1 || "https://via.placeholder.com/400x250?text=No+Photo"}" alt="${item.title || ""}" style="width:100%; height:200px; object-fit:cover;">
        <div class="card-body" style="padding: 15px;">
          <h3>${item.title || "Untitled listing"}</h3>
          <p class="location"><strong>Location:</strong> ${item.location || ""}</p>
          <p class="price"><strong>Rent:</strong> R ${Number(item.rent || 0).toLocaleString()} / month</p>
          <p class="meta">${item.bedrooms || "—"} Bed | ${item.bathrooms || "—"} Bath</p>
          <button type="button" class="btn-primary" onclick="selectPropertyForApp('${item.ref || item.id || ""}', '${(item.title || "").replace(/'/g, "\\'")}')">Apply Now</button>
        </div>
      </div>
    `).join("");
  } else {
    container.innerHTML = "<p>No active properties listed at this time.</p>";
  }
}

/**
 * 2. Landlord Profile Registration Submission
 *    Backend action: 'register' (needs Code_auth_additions.gs deployed)
 */
async function registerLandlordForm(event) {
  event.preventDefault();
  const form = event.target;
  const statusDiv = document.getElementById("registerStatus") || createStatusContainer(form);

  const username = form.username.value.trim();
  const email = form.email.value.trim();
  const phone = form.phone.value.trim();
  const password = form.password.value;
  const confirmPassword = form.confirmPassword.value;

  if (password !== confirmPassword) {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: Passwords do not match.</p>`;
    return;
  }
  if (password.length < 6) {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: Password must be at least 6 characters.</p>`;
    return;
  }

  statusDiv.innerHTML = "<p style='color: blue;'>Registering landlord profile...</p>";

  const passwordHash = await sha256Hex(password);
  // 'name' isn't collected on this form, so we fall back to the
  // username / email for display purposes on the backend.
  const displayName = username || email;

  const res = await apiRead("register", {
    username: username || email,
    passwordHash,
    name: displayName,
    phone,
    role: "Landlord"
  });

  if (res && res.ok) {
    saveSession(username || email, displayName, "Landlord");
    statusDiv.innerHTML = `<p style="color: green; font-weight: bold;">Landlord profile registered! You're signed in as ${displayName}.</p>`;
    form.reset();
  } else {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: ${(res && res.message) || "Could not reach the server."}</p>`;
  }
}

/**
 * 3. New Property Listing Submission (Landlords)
 *    Backend action: 'property' (requires a signed-in landlord session)
 */
async function submitNewListingForm(event) {
  event.preventDefault();
  const form = event.target;
  const statusDiv = document.getElementById("listingFormStatus") || createStatusContainer(form);

  const session = getSession();
  if (!session || session.role !== "Landlord") {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Please register / sign in as a Landlord above first.</p>`;
    return;
  }

  statusDiv.innerHTML = "<p style='color: blue;'>Uploading photos and publishing listing...</p>";

  const photoInput = form.querySelector('input[type="file"][name="propertyPhotos"]') || form.querySelector('#propertyPhotos');
  let photo1 = "";
  if (photoInput && photoInput.files.length > 0) {
    photo1 = await compressFileToBase64(photoInput.files[0]);
  }

  const ref = refWithPrefix("PROP");
  const payload = {
    ref,
    isUpdate: false,
    username: session.username,
    ownerName: session.name,
    propertyType: "Room",
    title: form.title ? form.title.value : "",
    location: form.location ? form.location.value : "",
    rent: form.rentAmount ? form.rentAmount.value : 0,
    deposit: form.deposit ? form.deposit.value : 0,
    bedrooms: form.bedrooms ? form.bedrooms.value : 1,
    bathrooms: form.bathrooms ? form.bathrooms.value : 1,
    description: form.description ? form.description.value : "",
    photo1,
    status: "Active",
    createdAt: new Date().toISOString()
  };

  const res = await apiWrite("property", payload);

  if (res.success) {
    statusDiv.innerHTML = `<p style="color: green; font-weight: bold;">Listing published! Reference: ${ref}</p>`;
    form.reset();
    fetchAndRenderListings(); // Refresh property grid
  } else {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: ${res.message}</p>`;
  }
}

/**
 * 4. Tenant Online Application Submission
 *    Backend action: 'application'
 */
async function submitTenantForm(event) {
  event.preventDefault();
  const form = event.target;
  const statusDiv = document.getElementById("formStatus") || createStatusContainer(form);

  statusDiv.innerHTML = "<p style='color: blue;'>Submitting application, please wait...</p>";

  const ref = refWithPrefix("APP");
  const payload = {
    ref,
    submittedAt: new Date().toISOString(),
    status: "Pending",
    name: form.fullName ? form.fullName.value : "",
    phone: form.phone ? form.phone.value : "",
    location: SELECTED_LISTING_LOCATION || "",
    moveInDate: form.moveInDate ? form.moveInDate.value : "",
    employmentStatus: form.employmentStatus ? form.employmentStatus.value : "",
    // Fields kept for reference even though the core 'application'
    // schema doesn't define columns for them — harmless if your
    // Code.gs ignores unknown properties, drop them here if it errors.
    idNumber: form.idNumber ? form.idNumber.value : "",
    email: form.email ? form.email.value : "",
    monthlyIncome: form.monthlyIncome ? form.monthlyIncome.value : 0,
    popiaConsent: form.popiaConsent ? form.popiaConsent.checked : false
  };

  const idFileInput = form.querySelector('input[type="file"][name="idDocument"]') || form.querySelector('#idDocumentFile');
  if (idFileInput && idFileInput.files[0]) {
    payload.idDocumentBase64 = await compressFileToBase64(idFileInput.files[0]);
  }

  const res = await apiWrite("application", payload);

  if (res.success) {
    statusDiv.innerHTML = `<p style="color: green; font-weight: bold;">Application Submitted Successfully! Reference: ${ref}</p>`;
    form.reset();
  } else {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: ${res.message}</p>`;
  }
}

/**
 * Utility: Target Selection Helper for Property Listings
 */
let SELECTED_LISTING_LOCATION = "";
function selectPropertyForApp(listingRef, propertyTitle) {
  const appSection = document.getElementById("applicationForm");
  if (appSection) {
    appSection.scrollIntoView({ behavior: "smooth" });
    const statusDiv = document.getElementById("formStatus");
    if (statusDiv) {
      statusDiv.innerHTML = `<p style="color: #0056b3;">Applying for property: <strong>${propertyTitle}</strong> (${listingRef})</p>`;
    }
  }
}

/**
 * Utility: Fallback Status Message Element Creator
 */
function createStatusContainer(formElement) {
  let statusDiv = document.createElement("div");
  statusDiv.className = "status-box";
  formElement.appendChild(statusDiv);
  return statusDiv;
}
