#include <DHT.h>

#define SOIL_PIN A0
#define DHT_PIN 2
#define RELAY_PIN 8
#define DHT_TYPE DHT11   // agar DHT22 bo'lsa shu yerni o'zgartiring

DHT dht(DHT_PIN, DHT_TYPE);

unsigned long oldingiVaqt = 0;
const long YUBORISH_ORALIGI = 5000; // 5 soniyada bir marta ma'lumot yuborish

bool pumpHolati = false;
unsigned long pumpYoqilganVaqt = 0;
const unsigned long MAX_PUMP_VAQT = 60000; // xavfsizlik: uzluksiz 60s dan ortiq ishlamasin

const int TUPROQ_QURUQ = 1023;  // havoda o'lchagandagi qiymat (eng quruq)
const int TUPROQ_HOL = 300;     // suvga botirgandagi qiymat (eng nam)

void setup() {
  Serial.begin(9600);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  dht.begin();
  Serial.println("{\"status\":\"tizim_ishga_tushdi\"}");
}

void loop() {
  unsigned long hozirgiVaqt = millis();

  if (hozirgiVaqt - oldingiVaqt >= YUBORISH_ORALIGI) {
    oldingiVaqt = hozirgiVaqt;
    yuborishSensorMalumotlari();
  }

  qabulQilishBuyruq();

  if (pumpHolati && (hozirgiVaqt - pumpYoqilganVaqt > MAX_PUMP_VAQT)) {
    releniOchirish();
    Serial.println("{\"warning\":\"max_vaqt_tugadi_pump_avtomatik_ochirildi\"}");
  }
}

void yuborishSensorMalumotlari() {
  int tuproqXom = analogRead(SOIL_PIN);
  int namlikFoiz = map(tuproqXom, TUPROQ_QURUQ, TUPROQ_HOL, 0, 100);
  namlikFoiz = constrain(namlikFoiz, 0, 100);

  float harorat = dht.readTemperature();
  float havoNamligi = dht.readHumidity();

  Serial.print("{");
  Serial.print("\"soil\":"); Serial.print(namlikFoiz);
  Serial.print(",\"temp\":"); Serial.print(isnan(harorat) ? -1 : harorat);
  Serial.print(",\"hum\":"); Serial.print(isnan(havoNamligi) ? -1 : havoNamligi);
  Serial.print(",\"pump\":"); Serial.print(pumpHolati ? "true" : "false");
  Serial.println("}");
}

void qabulQilishBuyruq() {
  if (Serial.available()) {
    String buyruq = Serial.readStringUntil('\n');
    buyruq.trim();

    if (buyruq == "PUMP_ON") {
      releniYoqish();
    } else if (buyruq == "PUMP_OFF") {
      releniOchirish();
    }
  }
}

void releniYoqish() {
  if (!pumpHolati) {
    digitalWrite(RELAY_PIN, HIGH);
    pumpHolati = true;
    pumpYoqilganVaqt = millis();
    Serial.println("{\"status\":\"pump_yoqildi\"}");
  }
}

void releniOchirish() {
  if (pumpHolati) {
    digitalWrite(RELAY_PIN, LOW);
    pumpHolati = false;
    Serial.println("{\"status\":\"pump_ochirildi\"}");
  }
}
require('dotenv').config();
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SOZLAMALAR = {
  minTuproqNamlik: 30,
  maxTuproqNamlik: 70,
  minHarorat: 5,
  maxHavoNamligi: 85,
  aiTekshiruvOraligi: 10 * 60 * 1000,
};

let oxirgiAiTekshiruv = 0;
let oxirgiAiQaror = null;

const port = new SerialPort({
  path: process.env.SERIAL_PORT || '/dev/ttyUSB0',
  baudRate: 9600,
});
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.on('open', () => console.log('✅ Arduino bilan aloqa ochildi'));
port.on('error', (err) => console.error('❌ Serial xato:', err.message));

parser.on('data', async (qator) => {
  let malumot;
  try {
    malumot = JSON.parse(qator.trim());
  } catch (e) {
    console.log('ℹ️  Arduino xabari:', qator.trim());
    return;
  }

  if (malumot.soil === undefined) return;

  console.log(`📊 Tuproq: ${malumot.soil}%  Harorat: ${malumot.temp}°C  Havo namligi: ${malumot.hum}%  Nasos: ${malumot.pump}`);

  const qaror = await qarorQabulQilish(malumot);

  if (qaror === 'ON' && !malumot.pump) {
    port.write('PUMP_ON\n');
    console.log('💧 Buyruq yuborildi: PUMP_ON');
  } else if (qaror === 'OFF' && malumot.pump) {
    port.write('PUMP_OFF\n');
    console.log('🛑 Buyruq yuborildi: PUMP_OFF');
  }
});

async function qarorQabulQilish(malumot) {
  if (malumot.temp !== -1 && malumot.temp < SOZLAMALAR.minHarorat) {
    return 'OFF';
  }
  if (malumot.soil >= SOZLAMALAR.maxTuproqNamlik) {
    return 'OFF';
  }
  if (malumot.soil < SOZLAMALAR.minTuproqNamlik &&
      malumot.hum !== -1 && malumot.hum < SOZLAMALAR.maxHavoNamligi) {
    return await aiTasdiqlash(malumot);
  }
  return 'OFF';
}

async function aiTasdiqlash(malumot) {
  const hozir = Date.now();

  if (hozir - oxirgiAiTekshiruv < SOZLAMALAR.aiTekshiruvOraligi && oxirgiAiQaror) {
    return oxirgiAiQaror;
  }

  try {
    const javob = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Sen tomorqa/issiqxona sug'orish tizimi uchun AI yordamchisisan.
Quyidagi sensor ma'lumotlariga asoslanib, hozir sug'orish kerakmi yoki yo'qmi
qaror qil. Faqat "ON" yoki "OFF" deb javob ber, boshqa hech narsa yozma.

Tuproq namligi: ${malumot.soil}%
Harorat: ${malumot.temp}°C
Havo namligi: ${malumot.hum}%
Mahalliy vaqt: ${new Date().toLocaleString('uz-UZ')}

Qoida: agar tuproq quruq (30% dan past) va havo haddan tashqari nam
bo'lmasa (zamburug' xavfi past) - odatda ON. Agar tungi soat 22:00-06:00
oralig'ida bo'lsa va vaziyat kritik bo'lmasa, ertalabgacha kutish afzal.`,
      }],
    });

    const matn = javob.content[0].text.trim().toUpperCase();
    const qaror = matn.includes('ON') ? 'ON' : 'OFF';

    oxirgiAiTekshiruv = hozir;
    oxirgiAiQaror = qaror;
    console.log(`🤖 Claude AI qarori: ${qaror}`);
    return qaror;
  } catch (err) {
    console.error("⚠️  AI xatosi, oddiy mantiqqa o'tildi:", err.message);
    return malumot.soil < SOZLAMALAR.minTuproqNamlik ? 'ON' : 'OFF';
  }
}

async function plantixTahlili(rasmYoli) {
  if (!process.env.PLANTIX_API_KEY) {
    console.log("ℹ️  Plantix API kaliti hali sozlanmagan - bu qadam o'tkazib yuborildi");
    return null;
  }

  const javob = await fetch(process.env.PLANTIX_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PLANTIX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image_url: rasmYoli }),
  });

  return await javob.json();
}

console.log("🌱 Tomorqa Kuzatuv AI-nazorat markazi ishga tushdi...");
npm init -y
npm install serialport @serialport/parser-readline @anthropic-ai/sdk dotenv
SERIAL_PORT=COM3
ANTHROPIC_API_KEY=sizning_kalitingiz
PLANTIX_API_KEY=
PLANTIX_API_URL=
