/**
 * SMART RESIDENTS FRONTEND CONTROLLER
 * Fully configured with Live Web App Endpoint & Landlord Registration
 */

// Live Google Apps Script Web App Endpoint URL
const API_URL = "https://script.google.com/macros/s/AKfycbzi5iCDzOhi48jzR3sJcsg7-sZwIKIEuy6hkMF1GP0TtXLUViUS22hN0kPeIDyZEtsp/exec";

/**
 * Universal API Request Handler
 * Standardized for Google Apps Script CORS redirects & text/plain payloads
 */
async function callApi(action, data = {}, method = "POST") {
  try {
    if (method === "GET") {
      const queryString = new URLSearchParams({ action, ...data }).toString();
      const response = await fetch(`${API_URL}?${queryString}`, {
        method: "GET",
        redirect: "follow"
      });
      return await response.json();
    }

    // POST Payload
    const response = await fetch(API_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action: action, data: data })
    });

    return await response.json();
  } catch (err) {
    console.error(`API Error during action [${action}]:`, err);
    return { success: false, message: "Network error or unreachable backend: " + err.message };
  }
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
 */
async function fetchAndRenderListings() {
  const container = document.getElementById("listingsContainer");
  if (!container) return;

  container.innerHTML = "<p>Loading active listings...</p>";

  const res = await callApi("getListings", {}, "GET");

  if (res.success && Array.isArray(res.data) && res.data.length > 0) {
    container.innerHTML = res.data.map(item => `
      <div class="property-card" id="listing-${item.id}">
        <img src="${item.photos && item.photos[0] ? item.photos[0] : 'https://via.placeholder.com/400x250?text=No+Photo'}" alt="${item.title}" style="width:100%; height:200px; object-fit:cover;">
        <div class="card-body" style="padding: 15px;">
          <h3>${item.title}</h3>
          <p class="location"><strong>Location:</strong> ${item.location}</p>
          <p class="price"><strong>Rent:</strong> R ${Number(item.rentAmount).toLocaleString()} / month</p>
          <p class="meta">${item.bedrooms} Bed | ${item.bathrooms} Bath</p>
          <button type="button" class="btn-primary" onclick="selectPropertyForApp('${item.id}', '${item.title}')">Apply Now</button>
        </div>
      </div>
    `).join('');
  } else {
    container.innerHTML = "<p>No active properties listed at this time.</p>";
  }
}

/**
 * 2. Landlord Profile Registration Submission
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

  // Frontend Password Match Check
  if (password !== confirmPassword) {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: Passwords do not match.</p>`;
    return;
  }

  statusDiv.innerHTML = "<p style='color: blue;'>Registering landlord profile...</p>";

  const payload = {
    username: username,
    email: email,
    phone: phone,
    password: password,
    confirmPassword: confirmPassword
  };

  const res = await callApi("registerLandlord", payload, "POST");

  if (res.success) {
    statusDiv.innerHTML = `<p style="color: green; font-weight: bold;">${res.message} Account ID: ${res.userId}</p>`;
    form.reset();
  } else {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: ${res.message}</p>`;
  }
}

/**
 * 3. New Property Listing Submission (Landlords)
 */
async function submitNewListingForm(event) {
  event.preventDefault();
  const form = event.target;
  const statusDiv = document.getElementById("listingFormStatus") || createStatusContainer(form);

  statusDiv.innerHTML = "<p style='color: blue;'>Uploading photos and publishing listing...</p>";

  const payload = {
    title: form.title ? form.title.value : "",
    location: form.location ? form.location.value : "",
    rentAmount: form.rentAmount ? form.rentAmount.value : 0,
    deposit: form.deposit ? form.deposit.value : 0,
    bedrooms: form.bedrooms ? form.bedrooms.value : 1,
    bathrooms: form.bathrooms ? form.bathrooms.value : 1,
    description: form.description ? form.description.value : "",
    photos: []
  };

  const photoInput = form.querySelector('input[type="file"][name="propertyPhotos"]') || form.querySelector('#propertyPhotos');
  if (photoInput && photoInput.files.length > 0) {
    for (let file of photoInput.files) {
      const base64 = await compressFileToBase64(file);
      payload.photos.push(base64);
    }
  }

  const res = await callApi("createListing", payload, "POST");

  if (res.success) {
    statusDiv.innerHTML = `<p style="color: green; font-weight: bold;">Listing published! Reference ID: ${res.listingId}</p>`;
    form.reset();
    fetchAndRenderListings(); // Refresh property grid
  } else {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: ${res.message}</p>`;
  }
}

/**
 * 4. Tenant Online Application Submission
 */
async function submitTenantForm(event) {
  event.preventDefault();
  const form = event.target;
  const statusDiv = document.getElementById("formStatus") || createStatusContainer(form);
  
  statusDiv.innerHTML = "<p style='color: blue;'>Submitting application, please wait...</p>";

  const payload = {
    fullName: form.fullName ? form.fullName.value : "",
    idNumber: form.idNumber ? form.idNumber.value : "",
    email: form.email ? form.email.value : "",
    phone: form.phone ? form.phone.value : "",
    employmentStatus: form.employmentStatus ? form.employmentStatus.value : "",
    monthlyIncome: form.monthlyIncome ? form.monthlyIncome.value : 0,
    moveInDate: form.moveInDate ? form.moveInDate.value : "",
    popiaConsent: form.popiaConsent ? form.popiaConsent.checked : false
  };

  // Process ID document file upload
  const idFileInput = form.querySelector('input[type="file"][name="idDocument"]') || form.querySelector('#idDocumentFile');
  if (idFileInput && idFileInput.files[0]) {
    payload.idDocumentBase64 = await compressFileToBase64(idFileInput.files[0]);
  }

  const res = await callApi("submitApplication", payload, "POST");

  if (res.success) {
    statusDiv.innerHTML = `<p style="color: green; font-weight: bold;">Application Submitted Successfully! Reference ID: ${res.applicationId}</p>`;
    form.reset();
  } else {
    statusDiv.innerHTML = `<p style="color: red; font-weight: bold;">Error: ${res.message}</p>`;
  }
}

/**
 * Utility: Target Selection Helper for Property Listings
 */
function selectPropertyForApp(listingId, propertyTitle) {
  const appSection = document.getElementById("applicationForm");
  if (appSection) {
    appSection.scrollIntoView({ behavior: "smooth" });
    const statusDiv = document.getElementById("formStatus");
    if (statusDiv) {
      statusDiv.innerHTML = `<p style="color: #0056b3;">Applying for property: <strong>${propertyTitle}</strong> (${listingId})</p>`;
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