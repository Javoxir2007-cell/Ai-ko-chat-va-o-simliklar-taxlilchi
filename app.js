// ====== SOZLAMALAR ======
const STAGES = [
  { key: "day1", label: "1-kun (boshlang'ich)" },
  { key: "day10", label: "10-kun" },
  { key: "day20", label: "20-kun" },
  { key: "day30", label: "30-kun" }
];

const MODEL = "claude-sonnet-4-6";

// ====== STORAGE YORDAMCHI FUNKSIYALAR ======
function getApiKey() {
  return localStorage.getItem("tk_api_key") || "";
}
function setApiKey(key) {
  localStorage.setItem("tk_api_key", key);
}
function getPlants() {
  return JSON.parse(localStorage.getItem("tk_plants") || "[]");
}
function savePlants(plants) {
  localStorage.setItem("tk_plants", JSON.stringify(plants));
}

// ====== DOM ELEMENTLAR ======
const apiKeyInput = document.getElementById("apiKeyInput");
const saveApiKeyBtn = document.getElementById("saveApiKeyBtn");
const apiKeyStatus = document.getElementById("apiKeyStatus");
const plantNameInput = document.getElementById("plantName");
const addPlantBtn = document.getElementById("addPlantBtn");
const plantsList = document.getElementById("plantsList");
const reportModal = document.getElementById("reportModal");
const reportTitle = document.getElementById("reportTitle");
const reportBody = document.getElementById("reportBody");
const closeModal = document.getElementById("closeModal");

// ====== INIT ======
window.addEventListener("DOMContentLoaded", () => {
  const savedKey = getApiKey();
  if (savedKey) {
    apiKeyInput.value = savedKey;
    apiKeyStatus.textContent = "✓ Saqlangan";
  }
  renderPlants();
});

saveApiKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) return alert("Iltimos API kalitni kiriting");
  setApiKey(key);
  apiKeyStatus.textContent = "✓ Saqlandi";
});

closeModal.addEventListener("click", () => reportModal.classList.add("hidden"));

// ====== KO'CHAT QO'SHISH ======
addPlantBtn.addEventListener("click", () => {
  const name = plantNameInput.value.trim();
  if (!name) return alert("Ko'chat nomini kiriting");

  const plants = getPlants();
  plants.push({
    id: Date.now().toString(),
    name,
    images: {}, // { day1: base64, day10: base64, ... }
    report: null
  });
  savePlants(plants);
  plantNameInput.value = "";
  renderPlants();
});

// ====== KO'CHATLARNI CHIZISH ======
function renderPlants() {
  const plants = getPlants();
  plantsList.innerHTML = "";

  if (plants.length === 0) {
    plantsList.innerHTML = `<p style="text-align:center;color:#888;">Hali ko'chat qo'shilmagan</p>`;
    return;
  }

  plants.forEach(plant => {
    const card = document.createElement("div");
    card.className = "plant-card";

    const stagesHtml = STAGES.map(stage => {
      const img = plant.images[stage.key];
      return `
        <div class="stage-box ${img ? 'filled' : ''}">
          <label>${stage.label}</label>
          ${img ? `<img src="${img}">` : ''}
          <label class="upload-label">
            ${img ? "Almashtirish" : "Rasm yuklash"}
            <input type="file" accept="image/*" data-plant="${plant.id}" data-stage="${stage.key}">
          </label>
        </div>
      `;
    }).join("");

    const filledCount = Object.keys(plant.images).length;
    const canAnalyze = filledCount >= 2;

    card.innerHTML = `
      <h3>
        🌿 ${plant.name}
        <button class="delete-plant" data-id="${plant.id}">O'chirish</button>
      </h3>
      <div class="stages">${stagesHtml}</div>
      <div class="analyze-row">
        <button class="analyze-btn" data-id="${plant.id}" ${canAnalyze ? '' : 'disabled'}>
          🔍 AI bilan tahlil qilish
        </button>
        ${!canAnalyze ? '<span class="hint">Kamida 2 ta rasm kerak</span>' : ''}
        ${plant.report ? `<span class="status-badge ${plant.report.status === 'good' ? 'status-good' : 'status-bad'}">
          ${plant.report.status === 'good' ? '✓ Holat yaxshi' : '⚠ Diqqat talab qiladi'}
        </span>
        <button class="view-report-btn" data-id="${plant.id}">Hisobotni ko'rish</button>` : ''}
      </div>
    `;

    plantsList.appendChild(card);
  });

  // Fayl yuklash hodisalari
  document.querySelectorAll('input[type="file"]').forEach(input => {
    input.addEventListener("change", handleImageUpload);
  });

  // Tahlil tugmalari
  document.querySelectorAll(".analyze-btn").forEach(btn => {
    btn.addEventListener("click", () => analyzePlant(btn.dataset.id));
  });

  // O'chirish tugmalari
  document.querySelectorAll(".delete-plant").forEach(btn => {
    btn.addEventListener("click", () => deletePlant(btn.dataset.id));
  });

  // Hisobot ko'rish tugmalari
  document.querySelectorAll(".view-report-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const plants = getPlants();
      const plant = plants.find(p => p.id === btn.dataset.id);
      showReport(plant);
    });
  });
}

// ====== RASM YUKLASH ======
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const plantId = e.target.dataset.plant;
  const stageKey = e.target.dataset.stage;

  const reader = new FileReader();
  reader.onload = () => {
    const plants = getPlants();
    const plant = plants.find(p => p.id === plantId);
    plant.images[stageKey] = reader.result; // base64 data URL
    savePlants(plants);
    renderPlants();
  };
  reader.readAsDataURL(file);
}

// ====== KO'CHATNI O'CHIRISH ======
function deletePlant(id) {
  if (!confirm("Rostdan ham o'chirmoqchimisiz?")) return;
  let plants = getPlants();
  plants = plants.filter(p => p.id !== id);
  savePlants(plants);
  renderPlants();
}

// ====== AI TAHLIL ======
async function analyzePlant(plantId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    alert("Avval API kalitni kiriting va saqlang");
    return;
  }

  const plants = getPlants();
  const plant = plants.find(p => p.id === plantId);

  const btn = document.querySelector(`.analyze-btn[data-id="${plantId}"]`);
  btn.disabled = true;
  btn.textContent = "⏳ Tahlil qilinmoqda...";

  try {
    // Mavjud rasmlarni tartib bilan yig'amiz
    const stagesWithImages = STAGES.filter(s => plant.images[s.key]);

    // Claude uchun content massivini tuzamiz: har bir rasm + uning yorlig'i
    const content = [];
    content.push({
      type: "text",
      text: `Quyida "${plant.name}" nomli o'simlik/ko'chatning turli kunlardagi rasmlari berilgan. Har bir rasm tartib bilan keladi.`
    });

    stagesWithImages.forEach(stage => {
      const base64 = plant.images[stage.key].split(",")[1];
      const mediaType = plant.images[stage.key].match(/data:(.*?);/)[1];
      content.push({
        type: "text",
        text: `--- ${stage.label} rasmi: ---`
      });
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 }
      });
    });

    content.push({
      type: "text",
      text: `Iltimos quyidagilarni O'ZBEK TILIDA, aniq va qisqa tarzda yoz:

1. Umumiy holat: YAXSHI yoki YOMON (faqat shu ikkitadan birini tanlang, boshida aniq belgilang)
2. O'sish dinamikasi: rasmlar orasida qanday o'zgarish kuzatildi (balandlik, barglar soni, rang)
3. Bargning rangi va holati: sog'lom yashilmi, sarg'aygan, qurib qolganmi
4. Tuproq/namlik belgilari (agar ko'rinsa)
5. Kasallik yoki zararkunanda alomatlari bormi
6. Tavsiya: nima qilish kerak (sug'orish rejimi, o'g'it, va h.k.)

Javobni quyidagi formatda boshla:
HOLAT: YAXSHI
yoki
HOLAT: YOMON

Keyin tahlilni davom ettir.`
    });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API xato (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || "").join("\n");

    const status = /HOLAT:\s*YOMON/i.test(text) ? "bad" : "good";

    plant.report = { text, status, date: new Date().toLocaleString("uz-UZ") };
    savePlants(plants);
    renderPlants();
    showReport(plant);

  } catch (err) {
    console.error(err);
    alert("Xatolik yuz berdi: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 AI bilan tahlil qilish";
  }
}

// ====== HISOBOTNI KO'RSATISH ======
function showReport(plant) {
  reportTitle.textContent = `📋 ${plant.name} — Hisobot`;
  reportBody.textContent = plant.report ? plant.report.text : "Hali hisobot yo'q";
  reportModal.classList.remove("hidden");
}
