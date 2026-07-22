const sourceData = window.SEOLSEONG_RACK_DATA || { racks: [], count: 0 };

const canvas = document.getElementById("warehouseCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const selectedInfo = document.getElementById("selectedInfo");

const rackZoneImage = new Image();
rackZoneImage.src = "assets/rack-only.png";
rackZoneImage.addEventListener("load", () => render());

const state = {
  scale: 1,
  selectedKey: "rack-01",
  hoverKey: null,
  hitBoxes: [],
  showZones: true,
  showCapa: true,
  showVacancy: true,
};

const refs = {
  totalCapa: document.getElementById("totalCapa"),
  usedCapa: document.getElementById("usedCapa"),
  useRate: document.getElementById("useRate"),
  rackCapa: document.getElementById("rackCapa"),
  bulkCapa: document.getElementById("bulkCapa"),
  workCapa: document.getElementById("workCapa"),
  zoneTable: document.getElementById("zoneTable"),
  donutRate: document.getElementById("donutRate"),
  donutCanvas: document.getElementById("donutCanvas"),
  trendCanvas: document.getElementById("trendCanvas"),
  showZones: document.getElementById("showZones"),
  showCapa: document.getElementById("showCapa"),
  showVacancy: document.getElementById("showVacancy"),
};

const customerPool = [
  { name: "오비맥주", color: "#d7892a" },
  { name: "피죤", color: "#2f80ed" },
  { name: "코스모코스", color: "#16a37b" },
  { name: "유니레버", color: "#7c5cff" },
  { name: "한국인삼공사", color: "#ef5555" },
  { name: "바이오포트코리아", color: "#d7b42f" },
  { name: "헨켈홈케어", color: "#36b7d7" },
  { name: "공실", color: "#d9e1e8" },
];

const zoneSummary = {
  rack: {
    key: "rack",
    name: "랙 보관 영역",
    color: "#3b82f6",
    capa: 12450,
    total: 16320,
    rate: 76.3,
    area: 6240,
  },
  bulk: {
    key: "bulk",
    name: "BULK 평치 영역",
    color: "#9aa6b2",
    capa: 2850,
    total: 16320,
    rate: 17.5,
    area: 2180,
  },
  work: {
    key: "work",
    name: "작업/기타 영역",
    color: "#e2b23b",
    capa: 1020,
    total: 16320,
    rate: 6.2,
    area: 1240,
  },
  inout: {
    key: "inout",
    name: "입/출고장",
    color: "#16a37b",
    capa: 0,
    total: 0,
    rate: 0,
    area: 480,
  },
};

function fmt(value) {
  return Number(Math.round(value || 0)).toLocaleString("ko-KR");
}

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function shade(hex, percent) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + percent));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + percent));
  const b = Math.max(0, Math.min(255, (n & 255) + percent));
  return `rgb(${r}, ${g}, ${b})`;
}

function countRackCells() {
  const map = new Map();
  (sourceData.racks || []).forEach((cell) => {
    const key = String(cell.rack || "").padStart(2, "0");
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

const cellCounts = countRackCells();

function buildRackCustomers(index, used) {
  const a = customerPool[index % 7];
  const b = customerPool[(index + 2) % 7];
  const c = customerPool[(index + 4) % 7];
  const first = Math.round(used * (0.46 + ((index % 3) * 0.08)));
  const second = Math.round((used - first) * 0.68);
  const third = Math.max(0, used - first - second);
  return [
    { ...a, plt: first },
    { ...b, plt: second },
    { ...c, plt: third },
  ].filter((item) => item.plt > 0);
}

const rackRates = [79, 78, 55, 52, 71, 41, 58, 93, 45, 62, 92, 62, 61, 78, 77, 74];
const racks = rackRates.map((rate, index) => {
  const no = String(index + 1).padStart(2, "0");
  const excelCells = cellCounts.get(String(index + 1)) || cellCounts.get(no) || 0;
  const capa = 680 + ((index % 4) * 70) + Math.floor(index / 4) * 35;
  const used = Math.round(capa * rate / 100);
  return {
    key: `rack-${no}`,
    no,
    name: `${no}번 랙`,
    capa,
    used,
    empty: capa - used,
    rate,
    excelCells,
    color: rate >= 90 ? "#ef4444" : rate >= 70 ? "#d7a21d" : "#16a37b",
    status: statusText(rate),
    customers: buildRackCustomers(index, used),
  };
});

function statusText(rate) {
  if (rate >= 90) return "혼잡";
  if (rate >= 70) return "주의";
  return "정상";
}

function setup() {
  refs.showZones.addEventListener("change", (event) => {
    state.showZones = event.target.checked;
    render();
  });
  refs.showCapa.addEventListener("change", (event) => {
    state.showCapa = event.target.checked;
    render();
  });
  refs.showVacancy.addEventListener("change", (event) => {
    state.showVacancy = event.target.checked;
    render();
  });

  document.getElementById("resetView").addEventListener("click", () => {
    state.scale = 1;
    state.selectedKey = "rack-01";
    render();
  });
  document.getElementById("rotateView").addEventListener("click", () => {
    state.scale = 1;
    render();
  });
  document.getElementById("zoomIn").addEventListener("click", () => {
    state.scale = Math.min(1.2, state.scale + 0.08);
    render();
  });
  document.getElementById("zoomOut").addEventListener("click", () => {
    state.scale = Math.max(0.86, state.scale - 0.08);
    render();
  });

  canvas.addEventListener("mousemove", handleMove);
  canvas.addEventListener("mouseleave", () => {
    state.hoverKey = null;
    tooltip.hidden = true;
    render();
  });
  canvas.addEventListener("click", handleClick);

  renderStaticPanels();
  render();
}

function renderStaticPanels() {
  const total = zoneSummary.rack.total;
  const used = zoneSummary.rack.capa + zoneSummary.bulk.capa + zoneSummary.work.capa;
  refs.totalCapa.textContent = `${fmt(total)} PLT`;
  refs.usedCapa.textContent = `${fmt(used)} PLT`;
  refs.useRate.textContent = pct(zoneSummary.rack.rate);
  refs.rackCapa.textContent = `${fmt(zoneSummary.rack.capa)} / ${fmt(total)} PLT`;
  refs.bulkCapa.textContent = `${fmt(zoneSummary.bulk.capa)} / ${fmt(total)} PLT`;
  refs.workCapa.textContent = `${fmt(zoneSummary.work.capa)} / ${fmt(total)} PLT`;
  refs.donutRate.textContent = `${pct(zoneSummary.rack.rate)} 사용`;

  refs.zoneTable.innerHTML = Object.values(zoneSummary)
    .filter((zone) => zone.key !== "inout")
    .map((zone) => `
      <tr>
        <td><i style="background:${zone.color}"></i>${zone.name}</td>
        <td>${fmt(zone.capa)} PLT</td>
        <td><b style="background:${zone.color}22;color:${zone.color}">${pct(zone.rate)}</b></td>
      </tr>
    `).join("");

  drawDonut();
  drawTrend();
}

function render() {
  state.hitBoxes = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const offsetX = (canvas.width - canvas.width * state.scale) / 2;
  const offsetY = (canvas.height - canvas.height * state.scale) / 2;
  ctx.save();
  ctx.setTransform(state.scale, 0, 0, state.scale, offsetX, offsetY);
  drawSceneBackground();
  drawFloorShell();
  drawFloorMarkings();
  drawDockArea();
  drawBulkArea();
  drawWorkArea();
  drawRackArea();
  drawZoneLabels();
  ctx.restore();
  renderSelected();
}

function drawSceneBackground() {
  const grd = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grd.addColorStop(0, "#07121d");
  grd.addColorStop(0.52, "#0d2132");
  grd.addColorStop(1, "#07121d");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawRackReferenceImage() {
  drawSingleRackPrototype();
  return;
  const imgW = rackZoneImage.naturalWidth || 354;
  const imgH = rackZoneImage.naturalHeight || 328;
  const frame = { x: 92, y: 58, w: 1046, h: 608 };
  const ratio = Math.min(frame.w / imgW, frame.h / imgH);
  const w = imgW * ratio;
  const h = imgH * ratio;
  const x = frame.x + (frame.w - w) / 2;
  const y = frame.y + (frame.h - h) / 2;

  ctx.save();

  if (rackZoneImage.complete && rackZoneImage.naturalWidth) {
    ctx.drawImage(rackZoneImage, x, y, w, h);
  } else {
    ctx.fillStyle = "#0b1724";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#dbeafe";
    ctx.font = "800 18px Segoe UI, Malgun Gothic";
    ctx.fillText("랙 보관 이미지 로딩 중", x + 28, y + 42);
  }

  ctx.restore();
  addRackReferenceHitBoxes(x, y, w, h);
}

function drawSingleRackPrototype() {
  state.hitBoxes = state.hitBoxes.filter((hit) => hit.type !== "rack");

  ctx.save();
  ctx.fillStyle = "#071421";
  ctx.fillRect(42, 44, 1186, 624);
  ctx.strokeStyle = "rgba(148,163,184,.28)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(42, 44, 1186, 624);

  ctx.fillStyle = "#e5f2ff";
  ctx.font = "900 24px Segoe UI, Malgun Gothic";
  ctx.fillText("설성센터 1층 랙별 CAPA 점유도", 72, 86);
  ctx.font = "700 13px Segoe UI, Malgun Gothic";
  ctx.fillStyle = "rgba(226,232,240,.76)";
  ctx.fillText("01~16번 랙을 클릭하면 우측에서 화주사별 사용 PLT와 여유 CAPA를 확인할 수 있습니다.", 72, 110);

  drawRackBlockLegend(932, 76);

  const cardW = 260;
  const cardH = 126;
  const gapX = 22;
  const gapY = 24;
  const startX = 72;
  const startY = 140;

  racks.slice(0, 16).forEach((rack, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    drawRackOccupancyCard(rack, startX + col * (cardW + gapX), startY + row * (cardH + gapY), cardW, cardH);
  });

  ctx.fillStyle = "rgba(148,163,184,.76)";
  ctx.font = "700 12px Segoe UI, Malgun Gothic";
  ctx.fillText("색상 블록 = 화주사 점유 / 흰색 블록 = 여유 CAPA / 퍼센트 = 랙별 사용률", 72, 636);
  ctx.restore();
}

function drawRackBlockLegend(x, y) {
  const items = [
    ["사용 구간", "#ef4444"],
    ["부분 사용", "#fca5a5"],
    ["여유 CAPA", "#f8fafc"],
  ];
  ctx.save();
  ctx.font = "800 12px Segoe UI, Malgun Gothic";
  ctx.textAlign = "left";
  items.forEach((item, i) => {
    const bx = x + i * 96;
    ctx.fillStyle = item[1];
    ctx.strokeStyle = item[1] === "#f8fafc" ? "#94a3b8" : "rgba(255,255,255,.35)";
    ctx.lineWidth = 1;
    roundRectPath(bx, y, 16, 16, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(226,232,240,.86)";
    ctx.fillText(item[0], bx + 22, y + 12);
  });
  ctx.restore();
}

function drawRackOccupancyCard(rack, x, y, w, h) {
  const rate = Math.max(0, Math.min(100, rack.rate));
  const statusColor = rate >= 90 ? "#ef4444" : rate >= 70 ? "#d59b18" : "#10b981";

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.32)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = state.selectedKey === rack.key ? "rgba(24,61,104,.94)" : "rgba(15,35,54,.94)";
  ctx.strokeStyle = state.selectedKey === rack.key ? "#60a5fa" : "rgba(148,163,184,.28)";
  ctx.lineWidth = state.selectedKey === rack.key ? 2.2 : 1.2;
  roundRectPath(x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#f8fbff";
  ctx.font = "900 19px Segoe UI, Malgun Gothic";
  ctx.fillText(`${String(rack.no).padStart(2, "0")}번 랙`, x + 16, y + 28);
  ctx.fillStyle = statusColor;
  ctx.font = "900 15px Segoe UI, Malgun Gothic";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(rate)}% 사용`, x + w - 16, y + 28);
  ctx.restore();

  drawLayeredRackBlock(x + 16, y + 42, 104, 62, rack);
  drawCustomerMiniStack(x + 136, y + 42, w - 152, 12, rack);

  ctx.save();
  ctx.fillStyle = "rgba(226,232,240,.86)";
  ctx.font = "800 11px Segoe UI, Malgun Gothic";
  ctx.fillText(`CAPA ${fmt(rack.capa)} PLT`, x + 136, y + 68);
  ctx.fillText(`사용 ${fmt(rack.used)} PLT`, x + 136, y + 88);
  ctx.fillStyle = rack.empty > 0 ? "#86efac" : "#fca5a5";
  ctx.fillText(`여유 ${fmt(rack.empty)} PLT`, x + 136, y + 108);
  ctx.restore();

  state.hitBoxes.push({
    key: rack.key,
    type: "rack",
    poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
  });
}

function drawLayeredRackBlock(x, y, w, h, rack) {
  const cols = 10;
  const levels = 5;
  const gap = 2;
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (levels - 1)) / levels;
  const totalCells = cols * levels;
  const usedCells = Math.round(totalCells * rack.rate / 100);
  const customerColors = rack.customers.length ? rack.customers.map((item) => item.color) : ["#ef4444"];

  ctx.save();
  ctx.strokeStyle = "rgba(96,165,250,.55)";
  ctx.lineWidth = 2;
  roundRectPath(x - 5, y - 5, w + 10, h + 10, 7);
  ctx.stroke();

  for (let level = 0; level < levels; level += 1) {
    for (let col = 0; col < cols; col += 1) {
      const idx = level * cols + col;
      const cx = x + col * (cellW + gap);
      const cy = y + (levels - 1 - level) * (cellH + gap);
      const used = idx < usedCells;
      const partial = idx === usedCells && rack.rate % (100 / totalCells) > 0;
      ctx.fillStyle = used ? customerColors[idx % customerColors.length] : partial ? "#fecaca" : "#f8fafc";
      ctx.strokeStyle = used ? "rgba(255,255,255,.32)" : "#cbd5e1";
      ctx.lineWidth = .8;
      roundRectPath(cx, cy, cellW, cellH, 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCustomerMiniStack(x, y, w, h, rack) {
  const total = Math.max(1, rack.used);
  let left = x;
  ctx.save();
  rack.customers.forEach((item) => {
    const segW = Math.max(8, w * item.plt / total);
    ctx.fillStyle = item.color;
    roundRectPath(left, y, Math.min(segW, x + w - left), h, 4);
    ctx.fill();
    left += segW;
  });
  if (left < x + w) {
    ctx.fillStyle = "#e5edf3";
    roundRectPath(left, y, x + w - left, h, 4);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(226,232,240,.72)";
  ctx.font = "700 10px Segoe UI, Malgun Gothic";
  ctx.fillText(rack.customers[0]?.name || "미배정", x, y + 28);
  ctx.restore();
}

function drawCompactRack(origin, number, rack, usage) {
  const axisX = { x: 30, y: 17 };
  const axisY = { x: -15, y: -12 };
  const levelH = 19;
  const cellsX = 4;
  const cellsY = 2;
  const levels = 5;
  const usedSlots = Math.round(cellsX * cellsY * levels * usage);
  const iso = (x, y, z = 0) => [
    origin.x + x * axisX.x + y * axisY.x,
    origin.y + x * axisX.y + y * axisY.y - z * levelH,
  ];

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 8;
  polygon([iso(-0.15, -0.25, 0), iso(cellsX + 0.25, -0.25, 0), iso(cellsX + 0.25, cellsY + 0.2, 0), iso(-0.15, cellsY + 0.2, 0)], "rgba(0,0,0,.22)", "transparent", 0);
  ctx.restore();

  let slot = 0;
  for (let x = cellsX - 1; x >= 0; x -= 1) {
    for (let y = cellsY - 1; y >= 0; y -= 1) {
      for (let z = 0; z < levels; z += 1) {
        slot += 1;
        const isUsed = slot <= usedSlots;
        drawRackCell(iso, x, y, z, isUsed);
      }
    }
  }

  drawCompactRackFrame(iso, cellsX, cellsY, levels);
  drawCompactRackLabel(iso(cellsX * 0.52, cellsY + 0.55, levels + 0.1), `${String(number).padStart(2, "0")}`);
  drawCompactRackFloorLabel(iso(cellsX * 0.46, -0.78, 0), `${Math.round(usage * 100)}%`);

  const poly = [iso(-0.25, -0.4, 0), iso(cellsX + 0.25, -0.4, 0), iso(cellsX + 0.35, cellsY + 0.35, levels), iso(-0.2, cellsY + 0.35, levels)];
  state.hitBoxes.push({ key: rack.key, type: "rack", poly });
}

function drawRackCell(iso, x, y, z, isUsed) {
  const w = 0.86;
  const d = 0.82;
  const h = 0.82;
  const p000 = iso(x, y, z);
  const p100 = iso(x + w, y, z);
  const p010 = iso(x, y + d, z);
  const p110 = iso(x + w, y + d, z);
  const p001 = iso(x, y, z + h);
  const p101 = iso(x + w, y, z + h);
  const p011 = iso(x, y + d, z + h);
  const p111 = iso(x + w, y + d, z + h);
  const top = isUsed ? "#ff4848" : "#f1f5f9";
  const left = isUsed ? "#ff8b8b" : "#cbd5e1";
  const right = isUsed ? "#c91717" : "#94a3b8";

  polygon([p001, p101, p111, p011], top, "rgba(255,255,255,.48)", 0.8);
  polygon([p010, p110, p111, p011], left, "rgba(255,255,255,.35)", 0.8);
  polygon([p100, p110, p111, p101], right, "rgba(255,255,255,.35)", 0.8);
  polygon([p000, p100, p110, p010], isUsed ? "rgba(180,0,0,.34)" : "rgba(100,116,139,.28)", "rgba(255,255,255,.16)", 0.6);
}

function drawCompactRackFrame(iso, cellsX, cellsY, levels) {
  ctx.save();
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (let x = 0; x <= cellsX; x += 1) {
    for (let y = 0; y <= cellsY; y += cellsY) {
      const bottom = iso(x, y, 0);
      const top = iso(x, y, levels);
      ctx.beginPath();
      ctx.moveTo(bottom[0], bottom[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
    }
  }

  for (let level = 0; level <= levels; level += 1) {
    [0, cellsY].forEach((y) => {
      const a = iso(0, y, level);
      const b = iso(cellsX, y, level);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    });
    [0, cellsX].forEach((x) => {
      const a = iso(x, 0, level);
      const b = iso(x, cellsY, level);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    });
  }
  ctx.restore();
}

function drawCompactRackLabel(point, text) {
  ctx.save();
  ctx.font = "900 16px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  roundRectPath(point[0] - 24, point[1] - 15, 48, 30, 5);
  ctx.fillStyle = "#0f172a";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.7)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, point[0], point[1] + 1);
  ctx.restore();
}

function drawCompactRackFloorLabel(point, text) {
  ctx.save();
  ctx.font = "900 14px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(point[0], point[1]);
  ctx.rotate(-0.55);
  ctx.fillStyle = Number.parseInt(text, 10) >= 80 ? "#ef4444" : "#e5e7eb";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawRackPallet(iso, x, y, level, w, d, h, hueShift) {
  const z = level + 0.1;
  const p100 = iso(x + w, y, z);
  const p010 = iso(x, y + d, z);
  const p110 = iso(x + w, y + d, z);
  const p001 = iso(x, y, z + h);
  const p101 = iso(x + w, y, z + h);
  const p011 = iso(x, y + d, z + h);
  const p111 = iso(x + w, y + d, z + h);
  const tops = ["#d39a3a", "#c8852e", "#d6a247", "#be7e2b", "#d19a45", "#b97824"];
  const top = tops[hueShift % tops.length];

  polygon([p001, p101, p111, p011], top, "rgba(12,62,105,.9)", 1);
  polygon([p010, p110, p111, p011], "#8b5a1f", "rgba(12,62,105,.85)", 1);
  polygon([p100, p110, p111, p101], "#704719", "rgba(12,62,105,.85)", 1);

  ctx.save();
  ctx.strokeStyle = "rgba(255,225,164,.3)";
  ctx.lineWidth = 1;
  const midA = iso(x + w * 0.5, y, z + h + 0.01);
  const midB = iso(x + w * 0.5, y + d, z + h + 0.01);
  ctx.beginPath();
  ctx.moveTo(midA[0], midA[1]);
  ctx.lineTo(midB[0], midB[1]);
  ctx.stroke();
  ctx.restore();
}

function drawRackFrame(iso, width, bays, levels) {
  ctx.save();
  ctx.strokeStyle = "#0c5d98";
  ctx.lineWidth = 3.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (let bay = 0; bay <= bays; bay += 1) {
    [0, width].forEach((x) => {
      const bottom = iso(x, bay, 0);
      const top = iso(x, bay, levels + 0.1);
      ctx.beginPath();
      ctx.moveTo(bottom[0], bottom[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
    });
  }

  for (let level = 0; level <= levels; level += 1) {
    [0, width].forEach((x) => {
      const a = iso(x, 0, level);
      const b = iso(x, bays, level);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    });
    for (let bay = 0; bay <= bays; bay += 2) {
      const a = iso(0, bay, level);
      const b = iso(width, bay, level);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = "rgba(53,148,232,.55)";
  ctx.lineWidth = 1.2;
  for (let bay = 0; bay <= bays; bay += 1) {
    const a = iso(0, bay, levels + 0.18);
    const b = iso(width, bay, levels + 0.18);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRackLabel(point, text) {
  ctx.save();
  ctx.font = "900 22px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 34;
  const h = 38;
  roundRectPath(point[0] - w / 2, point[1] - h / 2, w, h, 8);
  ctx.fillStyle = "#155fc7";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.62)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, point[0], point[1] + 1);
  ctx.restore();
}

function drawRackUsageBadge(point, text) {
  ctx.save();
  ctx.font = "900 18px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  roundRectPath(point[0] - 34, point[1] - 17, 68, 34, 17);
  ctx.fillStyle = "#d49a24";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, point[0], point[1]);
  ctx.restore();
}

function addRackReferenceHitBoxes(x, y, w, h) {
  const zones = [
    [[0.18, 0.07], [0.31, 0.07], [0.44, 0.88], [0.27, 0.88]],
    [[0.31, 0.07], [0.43, 0.07], [0.56, 0.88], [0.43, 0.88]],
    [[0.43, 0.07], [0.55, 0.07], [0.69, 0.88], [0.56, 0.88]],
    [[0.55, 0.07], [0.66, 0.07], [0.82, 0.88], [0.70, 0.88]],
    [[0.66, 0.07], [0.77, 0.07], [0.95, 0.84], [0.83, 0.88]],
  ];

  zones.forEach((poly, index) => {
    const rack = racks[index] || racks[0];
    if (!rack) return;
    state.hitBoxes.push({
      key: rack.key,
      type: "rack",
      poly: poly.map(([px, py]) => [x + px * w, y + py * h]),
    });
  });
}

function drawFloorShell() {
  polygon([[42, 44], [1228, 44], [1228, 668], [42, 668]], "#071421", "rgba(148,163,184,.22)", 1.4);
  return;
  const floor = [[72, 58], [1162, 58], [1210, 642], [118, 642]];
  polygon(floor, "#4a4f52", "rgba(255,255,255,.22)", 2);

  const wallTop = [[72, 58], [1162, 58], [1162, 96], [72, 96]];
  const wallLeft = [[72, 58], [118, 642], [88, 642], [48, 80]];
  const wallRight = [[1162, 58], [1210, 642], [1182, 642], [1144, 96]];
  polygon(wallTop, "#8d9499", "rgba(255,255,255,.22)", 1);
  polygon(wallLeft, "#6d7479", "rgba(255,255,255,.15)", 1);
  polygon(wallRight, "#6b7278", "rgba(255,255,255,.15)", 1);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let x = 130; x < 1140; x += 70) {
    ctx.beginPath();
    ctx.moveTo(x, 100);
    ctx.lineTo(x + 35, 628);
    ctx.stroke();
  }
  for (let y = 122; y < 630; y += 54) {
    ctx.beginPath();
    ctx.moveTo(106, y);
    ctx.lineTo(1184, y);
    ctx.stroke();
  }
  ctx.restore();

  drawLegend();
  drawFacilityDetails();
}

function drawLegend() {
  ctx.save();
  roundRectPath(26, 84, 128, 168, 6);
  ctx.fillStyle = "rgba(6,16,28,.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.stroke();
  ctx.fillStyle = "#f8fbff";
  ctx.font = "900 17px Segoe UI, Malgun Gothic";
  ctx.fillText("범례", 42, 112);
  const items = [
    ["#0b67a3", "랙 (4단)", "line"],
    ["#d6c08a", "기둥", "box"],
    ["#22c55e", "입출고장", "box"],
    ["#ef4444", "소화전", "box"],
    ["#9b5cff", "지게차 동선", "dash"],
    ["#ffd44a", "보행자 동선", "dash"],
  ];
  ctx.font = "800 12px Segoe UI, Malgun Gothic";
  items.forEach((item, idx) => {
    const y = 138 + idx * 20;
    if (item[2] === "box") {
      ctx.fillStyle = item[0];
      ctx.fillRect(42, y - 9, 12, 12);
    } else {
      ctx.strokeStyle = item[0];
      ctx.lineWidth = item[2] === "dash" ? 2 : 3;
      ctx.setLineDash(item[2] === "dash" ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(42, y - 3);
      ctx.lineTo(58, y - 3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = "rgba(236,248,255,.92)";
    ctx.fillText(item[1], 66, y);
  });
  ctx.restore();
}

function drawFacilityDetails() {
  ctx.save();
  for (let i = 0; i < 9; i += 1) {
    drawColumn(142 + i * 120, 104, 12, 26);
    drawColumn(152 + i * 116, 582, 12, 26);
  }
  for (let i = 0; i < 8; i += 1) {
    const x = 172 + i * 132;
    ctx.fillStyle = "#b8c0c7";
    ctx.fillRect(x, 64, 44, 18);
    ctx.fillStyle = "#13212d";
    ctx.fillRect(x + 6, 68, 32, 10);
  }
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = "#d71920";
    ctx.fillRect(318 + i * 168, 262, 11, 16);
    ctx.fillStyle = "#fff";
    ctx.font = "700 7px Segoe UI";
    ctx.fillText("F", 321 + i * 168, 273);
  }
  roundRectPath(90, 608, 80, 28, 5);
  ctx.fillStyle = "#147f49";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.38)";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "900 15px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("입/출고장", 130, 622);
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.moveTo(158, 574);
  ctx.lineTo(176, 546);
  ctx.lineTo(176, 566);
  ctx.lineTo(198, 558);
  ctx.lineTo(168, 596);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff4444";
  ctx.beginPath();
  ctx.arc(1134, 78, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f8fbff";
  ctx.font = "800 11px Segoe UI";
  ctx.fillText("CCTV", 1152, 80);
  ctx.restore();
}

function drawFloorMarkings() {
  return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = "rgba(255,208,69,.82)";
  for (let i = 0; i < 6; i += 1) {
    const x = 174 + i * 168;
    ctx.strokeRect(x - 10, 108, 126, 478);
  }
  ctx.strokeRect(96, 592, 1048, 32);

  ctx.strokeStyle = "rgba(154,87,255,.8)";
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 5; i += 1) {
    const x = 314 + i * 168;
    ctx.beginPath();
    ctx.moveTo(x, 114);
    ctx.bezierCurveTo(x + 22, 220, x - 20, 418, x + 14, 582);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(47,128,237,.82)";
  ctx.lineWidth = 2;
  roundRectPath(142, 96, 972, 500, 8);
  ctx.stroke();
  ctx.restore();
}

function drawRackArea() {
  drawRackReferenceImage();
  return;
  const letters = ["A", "B", "C", "D", "E", "F"];
  letters.forEach((letter, index) => {
    drawWarehouseRackBlock(letter, 184 + index * 168, 112, index);
  });
}

function drawWarehouseRackBlock(letter, x, y, aisleIndex) {
  const rackWidth = 94;
  const bayHeight = 28;
  const depth = 8;
  const bayCount = 16;
  const selectedStroke = "rgba(255,255,255,.95)";

  drawAisleHeader(letter, x + rackWidth / 2, y - 22);
  for (let bay = 0; bay < bayCount; bay += 1) {
    const rack = racks[bay % racks.length];
    const yy = y + bay * bayHeight;
    const label = `${letter}-${String(bay + 1).padStart(2, "0")}`;
    const poly = [[x, yy], [x + rackWidth, yy], [x + rackWidth + depth, yy + depth], [x + depth, yy + depth]];
    state.hitBoxes.push({ key: rack.key, type: "rack", poly });
    drawRackBay(x, yy, rackWidth, bayHeight - 3, depth, rack, aisleIndex, bay);
    drawRackBayLabel(label, x + rackWidth / 2, yy + bayHeight / 2 - 1, state.selectedKey === rack.key);
  }

  ctx.save();
  ctx.strokeStyle = state.hoverKey ? "rgba(108,168,255,.32)" : "rgba(38,120,220,.62)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 4, y - 4, rackWidth + depth + 8, bayCount * bayHeight + 4);
  ctx.restore();

  const rack = racks[aisleIndex % racks.length];
  if (state.showCapa) drawRackRateBadge(rack, x + 12, y + bayCount * bayHeight + 16);
}

function drawRackBay(x, y, w, h, d, rack, aisleIndex, bayIndex) {
  const selected = state.selectedKey === rack.key;
  const occupiedLevels = Math.max(1, Math.min(4, Math.round(rack.rate / 25)));
  const customer = rack.customers[(aisleIndex + bayIndex) % rack.customers.length] || customerPool[0];
  const rackFrame = selected ? "#f8fbff" : "#0b67a3";
  const deck = selected ? "#315f95" : "#15364f";

  polygon([[x, y], [x + w, y], [x + w + d, y + d], [x + d, y + d]], deck, "rgba(255,255,255,.18)");
  polygon([[x + w, y], [x + w + d, y + d], [x + w + d, y + h + d], [x + w, y + h]], "#082c45", "rgba(255,255,255,.12)");
  ctx.fillStyle = "#9b6a2f";
  ctx.fillRect(x + 7, y + 5, w - 14, h - 10);

  const levelH = (h - 7) / 4;
  for (let level = 0; level < 4; level += 1) {
    const filled = level < occupiedLevels;
    ctx.fillStyle = filled ? customer.color : "rgba(230,237,242,.9)";
    ctx.fillRect(x + 9, y + h - 5 - (level + 1) * levelH, w - 18, Math.max(3, levelH - 2));
  }

  ctx.strokeStyle = rackFrame;
  ctx.lineWidth = selected ? 2.4 : 1.25;
  for (let post = 0; post <= 3; post += 1) {
    const px = x + post * (w / 3);
    ctx.beginPath();
    ctx.moveTo(px, y + 2);
    ctx.lineTo(px, y + h);
    ctx.stroke();
  }
  for (let level = 0; level <= 4; level += 1) {
    const py = y + level * (h / 4);
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x + w, py);
    ctx.stroke();
  }
}

function drawAisleHeader(letter, x, y) {
  ctx.save();
  roundRectPath(x - 24, y - 12, 48, 24, 4);
  ctx.fillStyle = "rgba(10,25,42,.92)";
  ctx.fill();
  ctx.strokeStyle = "#69a9ff";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "900 14px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${letter}열`, x, y);
  ctx.restore();
}

function drawRackBayLabel(text, x, y, selected) {
  ctx.save();
  roundRectPath(x - 27, y - 10, 54, 20, 3);
  ctx.fillStyle = selected ? "#2563eb" : "rgba(7,28,48,.88)";
  ctx.fill();
  ctx.strokeStyle = "#74b8ff";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "900 12px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawRackRateBadge(rack, x, y) {
  ctx.save();
  const text = `${rack.rate}%`;
  roundRectPath(x, y, 54, 21, 10);
  ctx.fillStyle = rack.color;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "900 12px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 27, y + 10);
  ctx.restore();
}

function drawRackAisleGuides() {
  ctx.save();
  ctx.strokeStyle = "rgba(245,196,70,.55)";
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 1.2;
  for (let lane = 0; lane < 8; lane += 1) {
    const x = 251 + lane * 70;
    const y = 159 + lane * 6;
    ctx.beginPath();
    ctx.moveTo(x, y + 10);
    ctx.lineTo(x + 160, y + 392);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 66, y + 4);
    ctx.lineTo(x + 226, y + 386);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWarehouseRackRow(plan) {
  const { rack, sx, sy, bays, dx, dy } = plan;
  const rowPoly = [
    [sx - 17, sy + 28],
    [sx + dx * bays + 30, sy + dy * bays + 30],
    [sx + dx * bays + 52, sy + dy * bays - 30],
    [sx + 3, sy - 52],
  ];
  const selected = state.selectedKey === rack.key;
  const hovered = state.hoverKey === rack.key;

  state.hitBoxes.push({ key: rack.key, type: "rack", poly: rowPoly });
  polygon(rowPoly, selected ? "rgba(96,165,250,.14)" : "rgba(5,12,22,.12)", selected || hovered ? "#ffffff" : "rgba(59,130,246,.18)", selected ? 3 : 1);

  const levels = 4;
  const totalSlots = bays * levels;
  const filledSlots = Math.round(totalSlots * rack.rate / 100);
  let slot = 0;

  for (let bay = bays - 1; bay >= 0; bay -= 1) {
    for (let level = 0; level < levels; level += 1) {
      const occupied = slot < filledSlots;
      if (occupied || state.showVacancy) {
        const customer = rack.customers[(bay + level) % rack.customers.length] || customerPool[0];
        const color = occupied ? customer.color : "#dfe6ec";
        drawRackCell(sx + bay * dx, sy + bay * dy - level * 13, color, occupied);
      }
      slot += 1;
    }
  }

  drawRackUprights(sx, sy, bays, dx, dy);
  drawRackNumberPlate(rack, sx - 28, sy - 32);
  if (state.showCapa) {
    drawRackRateLabel(rack, sx + dx * bays + 32, sy + dy * bays - 6);
  }
}

function drawRackCell(x, y, color, occupied) {
  const top = occupied ? shade(color, 24) : "#edf3f7";
  const side = occupied ? shade(color, -28) : "#c9d4dc";
  const front = occupied ? color : "#e5edf2";
  polygon([[x, y], [x + 21, y + 4], [x + 31, y - 2], [x + 10, y - 7]], top, "rgba(255,255,255,.18)");
  polygon([[x, y], [x + 21, y + 4], [x + 21, y + 14], [x, y + 10]], front, "rgba(0,0,0,.12)");
  polygon([[x + 21, y + 4], [x + 31, y - 2], [x + 31, y + 8], [x + 21, y + 14]], side, "rgba(0,0,0,.18)");
}

function drawRackUprights(sx, sy, bays, dx, dy) {
  ctx.save();
  ctx.strokeStyle = "rgba(12,74,140,.9)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= bays; i += 2) {
    const x = sx + i * dx;
    const y = sy + i * dy;
    ctx.beginPath();
    ctx.moveTo(x, y + 15);
    ctx.lineTo(x + 10, y - 54);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRackNumberPlate(rack, x, y) {
  ctx.save();
  roundRectPath(x, y, 58, 26, 5);
  ctx.fillStyle = state.selectedKey === rack.key ? "#2563eb" : "rgba(5,18,32,.9)";
  ctx.fill();
  ctx.strokeStyle = "#89b8ff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 15px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${rack.no}번`, x + 29, y + 13);
  ctx.restore();
}

function drawRackRateLabel(rack, x, y) {
  ctx.save();
  ctx.font = "900 12px Segoe UI, Malgun Gothic";
  const text = `${rack.rate}%`;
  const width = ctx.measureText(text).width + 18;
  roundRectPath(x, y, width, 22, 11);
  ctx.fillStyle = `${rack.color}dd`;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + width / 2, y + 11);
  ctx.restore();
}

function drawBulkArea() {
  return;
  const poly = [[1036, 132], [1164, 132], [1178, 380], [1018, 380]];
  if (state.showZones) polygon(poly, "rgba(148,163,184,.17)", "rgba(80,150,255,.82)", 2);
  state.hitBoxes.push({ key: "bulk", type: "zone", poly });
  for (let i = 0; i < 14; i += 1) {
    const x = 1054 + (i % 4) * 31;
    const y = 166 + Math.floor(i / 4) * 56;
    drawColumn(x, y, 12, 48);
  }
}

function drawWorkArea() {
  return;
  const poly = [[892, 446], [1180, 446], [1186, 624], [876, 624]];
  if (state.showZones) polygon(poly, "rgba(226,178,59,.16)", "rgba(226,178,59,.86)", 2);
  state.hitBoxes.push({ key: "work", type: "zone", poly });
  for (let i = 0; i < 18; i += 1) {
    drawCuboid(912 + (i % 6) * 42, 500 + Math.floor(i / 6) * 34, 24, 12, 6, i % 3 ? "#8d7b65" : "#6f7b85");
  }
}

function drawDockArea() {
  return;
  const poly = [[82, 590], [192, 590], [192, 636], [82, 636]];
  if (state.showZones) polygon(poly, "rgba(49,181,109,.22)", "rgba(49,181,109,.92)", 2);
  state.hitBoxes.push({ key: "inout", type: "zone", poly });
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.12)";
  for (let i = 0; i < 6; i += 1) ctx.fillRect(96 + i * 14, 612, 8, 18);
  ctx.restore();
}

function drawColumn(x, y, w = 12, h = 66) {
  drawCuboid(x, y, w, h, 7, "#b9c0c8", "rgba(255,255,255,.22)");
}

function drawZoneLabels() {
  return;
  if (!state.showZones) return;
  drawLabel("랙 보관 영역", 612, 92, "#1d5fb8");
  drawLabel("BULK 평치 영역", 1096, 406, "#65707c");
  drawLabel("작업/기타 영역", 1024, 476, "#b98606");
  if (state.showCapa) {
    drawSmallValue("12,450 PLT · 76.3%", 612, 120);
    drawSmallValue("2,850 PLT · 17.5%", 1096, 432);
    drawSmallValue("1,020 PLT · 6.2%", 1024, 502);
  }
  return;
  drawLabel("01~16 랙 보관 영역", 586, 346, "#1d5fb8");
  drawLabel("BULK 평치 영역", 982, 346, "#65707c");
  drawLabel("작업/기타 영역", 936, 522, "#b98606");
  drawLabel("입/출고장", 228, 552, "#147f49");

  if (!state.showCapa) return;
  drawSmallValue("12,450 PLT · 76.3%", 586, 376);
  drawSmallValue("2,850 PLT · 17.5%", 982, 376);
  drawSmallValue("1,020 PLT · 6.2%", 936, 552);
}

function drawLabel(text, x, y, color) {
  ctx.save();
  ctx.font = "900 17px Segoe UI, Malgun Gothic";
  const width = ctx.measureText(text).width + 30;
  roundRectPath(x - width / 2, y - 20, width, 40, 7);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.58)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawSmallValue(text, x, y) {
  ctx.save();
  ctx.font = "800 13px Segoe UI, Malgun Gothic";
  ctx.fillStyle = "rgba(236,248,255,.92)";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawCuboid(x, y, w, h, d, fill, stroke = "rgba(255,255,255,.18)") {
  const top = [[x, y], [x + w, y + d], [x + w + d, y], [x + d, y - d]];
  const front = [[x, y], [x + w, y + d], [x + w, y + d + h], [x, y + h]];
  const side = [[x + w, y + d], [x + w + d, y], [x + w + d, y + h], [x + w, y + d + h]];
  polygon(front, fill, stroke);
  polygon(side, shade(fill, -30), stroke);
  polygon(top, shade(fill, 24), stroke);
}

function polygon(points, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function roundRectPath(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function handleMove(event) {
  const point = getCanvasPoint(event);
  const hit = findHit(point.x, point.y);
  const nextHover = hit ? hit.key : null;
  if (nextHover !== state.hoverKey) {
    state.hoverKey = nextHover;
    render();
  }
  if (hit) {
    tooltip.hidden = false;
    tooltip.style.left = `${event.offsetX + 18}px`;
    tooltip.style.top = `${event.offsetY + 18}px`;
    tooltip.innerHTML = tooltipHtml(hit.key);
  } else {
    tooltip.hidden = true;
  }
}

function handleClick(event) {
  const point = getCanvasPoint(event);
  const hit = findHit(point.x, point.y);
  if (!hit) return;
  state.selectedKey = hit.key;
  render();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  const offsetX = (canvas.width - canvas.width * state.scale) / 2;
  const offsetY = (canvas.height - canvas.height * state.scale) / 2;
  return {
    x: (x - offsetX) / state.scale,
    y: (y - offsetY) / state.scale,
  };
}

function findHit(x, y) {
  for (let i = state.hitBoxes.length - 1; i >= 0; i -= 1) {
    const hit = state.hitBoxes[i];
    if (pointInPoly(x, y, hit.poly)) return hit;
  }
  return null;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function tooltipHtml(key) {
  const rack = getRack(key);
  if (rack) {
    return `<strong>${rack.name}</strong>
      사용률 ${pct(rack.rate)} · ${rack.status}<br>
      사용 ${fmt(rack.used)} PLT / CAPA ${fmt(rack.capa)} PLT<br>
      주요 고객사 ${rack.customers[0]?.name || "-"}`
  }
  const zone = getZone(key);
  return `<strong>${zone.name}</strong>
    CAPA ${fmt(zone.capa)} PLT<br>
    사용률 ${pct(zone.rate)} · 면적 ${fmt(zone.area)}㎡`;
}

function renderSelected() {
  const rack = getRack(state.selectedKey);
  if (rack) {
    renderRackInfo(rack);
    return;
  }
  const zone = getZone(state.selectedKey) || zoneSummary.rack;
  selectedInfo.innerHTML = `
    <span>현재 확인 영역 정보</span>
    <strong style="color:${zone.color}">${zone.name}</strong>
    <p>${zone.name} 기준 CAPA와 점유율입니다. 랙 번호를 클릭하면 고객사별 상세가 표시됩니다.</p>
    <dl>
      <div><dt>면적</dt><dd>${fmt(zone.area)}㎡</dd></div>
      <div><dt>CAPA</dt><dd>${fmt(zone.capa)} PLT</dd></div>
      <div><dt>사용률</dt><dd>${pct(zone.rate)}</dd></div>
    </dl>
  `;
}

function renderRackInfo(rack) {
  selectedInfo.innerHTML = `
    <span>선택 랙 정보</span>
    <strong style="color:${rack.color}">${rack.name} · ${rack.status}</strong>
    <p>${rack.name}은 현재 ${fmt(rack.used)} PLT 사용 중이며, 잔여 가능 CAPA는 ${fmt(rack.empty)} PLT입니다.</p>
    <dl>
      <div><dt>CAPA</dt><dd>${fmt(rack.capa)} PLT</dd></div>
      <div><dt>사용</dt><dd>${fmt(rack.used)} PLT</dd></div>
      <div><dt>여유</dt><dd>${fmt(rack.empty)} PLT</dd></div>
      <div><dt>사용률</dt><dd>${pct(rack.rate)}</dd></div>
      <div><dt>엑셀 셀</dt><dd>${fmt(rack.excelCells)}개</dd></div>
    </dl>
    <table class="rack-detail">
      <thead><tr><th>고객사</th><th>보관 PLT</th><th>비중</th></tr></thead>
      <tbody>
        ${rack.customers.map((item) => `
          <tr>
            <td><i style="background:${item.color}"></i>${item.name}</td>
            <td>${fmt(item.plt)}</td>
            <td>${pct(item.plt / rack.used * 100)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function tooltipHtml(key) {
  const rack = getRack(key);
  if (rack) {
    return `<strong>${String(rack.no).padStart(2, "0")}번 랙</strong>
      사용률 ${pct(rack.rate)} · ${rack.status}<br>
      사용 ${fmt(rack.used)} PLT / CAPA ${fmt(rack.capa)} PLT<br>
      여유 ${fmt(rack.empty)} PLT<br>
      주요 화주사 ${rack.customers[0]?.name || "-"}`;
  }
  const zone = getZone(key);
  return `<strong>${zone.name}</strong>
    CAPA ${fmt(zone.capa)} PLT<br>
    사용률 ${pct(zone.rate)} · 면적 ${fmt(zone.area)}㎡`;
}

function renderSelected() {
  const rack = getRack(state.selectedKey);
  if (rack) {
    renderRackInfo(rack);
    return;
  }
  const zone = getZone(state.selectedKey) || zoneSummary.rack;
  selectedInfo.innerHTML = `
    <span>현재 확인 영역 정보</span>
    <strong style="color:${zone.color}">${zone.name}</strong>
    <p>${zone.name} 기준 CAPA 요약입니다. 01~16번 랙을 클릭하면 화주사별 상세 사용 현황을 확인할 수 있습니다.</p>
    <dl>
      <div><dt>면적</dt><dd>${fmt(zone.area)}㎡</dd></div>
      <div><dt>CAPA</dt><dd>${fmt(zone.capa)} PLT</dd></div>
      <div><dt>사용률</dt><dd>${pct(zone.rate)}</dd></div>
    </dl>
  `;
}

function renderRackInfo(rack) {
  const used = Math.max(1, rack.used);
  selectedInfo.innerHTML = `
    <span>선택 랙 정보</span>
    <strong style="color:${rack.color}">${String(rack.no).padStart(2, "0")}번 랙 · ${rack.status}</strong>
    <p>${String(rack.no).padStart(2, "0")}번 랙은 현재 ${fmt(rack.used)} PLT 사용 중이며, 여유 CAPA는 ${fmt(rack.empty)} PLT입니다.</p>
    <dl>
      <div><dt>CAPA</dt><dd>${fmt(rack.capa)} PLT</dd></div>
      <div><dt>사용</dt><dd>${fmt(rack.used)} PLT</dd></div>
      <div><dt>여유</dt><dd>${fmt(rack.empty)} PLT</dd></div>
      <div><dt>사용률</dt><dd>${pct(rack.rate)}</dd></div>
      <div><dt>엑셀 셀</dt><dd>${fmt(rack.excelCells)}개</dd></div>
    </dl>
    <table class="rack-detail">
      <thead><tr><th>화주사</th><th>보관 PLT</th><th>비중</th></tr></thead>
      <tbody>
        ${rack.customers.map((item) => `
          <tr>
            <td><i style="background:${item.color}"></i>${item.name}</td>
            <td>${fmt(item.plt)}</td>
            <td>${pct(item.plt / used * 100)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function getRack(key) {
  return racks.find((rack) => rack.key === key);
}

function getZone(key) {
  return zoneSummary[key];
}

function drawDonut() {
  const c = refs.donutCanvas;
  const dctx = c.getContext("2d");
  dctx.clearRect(0, 0, c.width, c.height);
  const cx = 46;
  const cy = 46;
  const rate = zoneSummary.rack.rate / 100;
  dctx.lineWidth = 12;
  dctx.strokeStyle = "rgba(255,255,255,.12)";
  dctx.beginPath();
  dctx.arc(cx, cy, 31, 0, Math.PI * 2);
  dctx.stroke();
  dctx.strokeStyle = "#3b82f6";
  dctx.beginPath();
  dctx.arc(cx, cy, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rate);
  dctx.stroke();
  dctx.fillStyle = "#ecf8ff";
  dctx.font = "900 13px Segoe UI";
  dctx.textAlign = "center";
  dctx.textBaseline = "middle";
  dctx.fillText("76.3%", cx, cy);
}

function drawTrend() {
  const c = refs.trendCanvas;
  const tctx = c.getContext("2d");
  const values = [73, 69, 78, 77, 82, 78, 76.3];
  tctx.clearRect(0, 0, c.width, c.height);
  tctx.strokeStyle = "rgba(255,255,255,.12)";
  tctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = 20 + i * 26;
    tctx.beginPath();
    tctx.moveTo(38, y);
    tctx.lineTo(292, y);
    tctx.stroke();
  }
  tctx.strokeStyle = "#60a5fa";
  tctx.lineWidth = 3;
  tctx.beginPath();
  values.forEach((v, i) => {
    const x = 42 + i * 40;
    const y = 124 - v;
    if (i === 0) tctx.moveTo(x, y);
    else tctx.lineTo(x, y);
  });
  tctx.stroke();
  values.forEach((v, i) => {
    const x = 42 + i * 40;
    const y = 124 - v;
    tctx.fillStyle = "#bfe0ff";
    tctx.beginPath();
    tctx.arc(x, y, 4, 0, Math.PI * 2);
    tctx.fill();
  });
  tctx.fillStyle = "#a7b6c6";
  tctx.font = "11px Segoe UI";
  ["05/05", "05/06", "05/07", "05/08", "05/09", "05/10", "05/11"].forEach((label, i) => {
    tctx.fillText(label, 26 + i * 40, 150);
  });
}

function drawSingleRackPrototype() {
  const panel = { x: 42, y: 44, w: 1186, h: 624 };
  const floor = { x: 78, y: 116, w: 1078, h: 472 };
  state.hitBoxes = state.hitBoxes.filter((hit) => hit.type !== "rack");

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#06131f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawWarehouseShell(floor);
  drawDockArea(floor.x + 20, floor.y + floor.h - 84);
  drawBulkArea(floor.x + floor.w - 238, floor.y + 118, 210, 192);
  drawWorkArea(floor.x + floor.w - 250, floor.y + floor.h - 92, 222, 64);
  drawAisleLines(floor);

  ctx.fillStyle = "#eaf6ff";
  ctx.font = "900 23px Segoe UI, Malgun Gothic";
  ctx.textAlign = "left";
  ctx.fillText("설성센터 1F 랙 보관 CAPA", panel.x + 24, panel.y + 34);
  ctx.font = "700 12px Segoe UI, Malgun Gothic";
  ctx.fillStyle = "rgba(226,232,240,.76)";
  ctx.fillText("01~16번 랙을 클릭하면 랙별 화주사 사용량과 여유 CAPA를 확인할 수 있습니다.", panel.x + 24, panel.y + 58);
  drawRackBlockLegend(panel.x + panel.w - 420, panel.y + 24);

  const rackLayout = [
    { x: floor.x + 112, y: floor.y + 64 }, { x: floor.x + 232, y: floor.y + 58 },
    { x: floor.x + 352, y: floor.y + 52 }, { x: floor.x + 472, y: floor.y + 46 },
    { x: floor.x + 112, y: floor.y + 214 }, { x: floor.x + 232, y: floor.y + 208 },
    { x: floor.x + 352, y: floor.y + 202 }, { x: floor.x + 472, y: floor.y + 196 },
    { x: floor.x + 112, y: floor.y + 364 }, { x: floor.x + 232, y: floor.y + 358 },
    { x: floor.x + 352, y: floor.y + 352 }, { x: floor.x + 472, y: floor.y + 346 },
    { x: floor.x + 628, y: floor.y + 92 }, { x: floor.x + 628, y: floor.y + 232 },
    { x: floor.x + 628, y: floor.y + 372 }, { x: floor.x + 752, y: floor.y + 366 },
  ];

  racks.slice(0, 16).forEach((rack, index) => {
    drawIsometricRack(rackLayout[index].x, rackLayout[index].y, rack);
  });

  ctx.fillStyle = "rgba(2, 6, 23, .72)";
  ctx.strokeStyle = "rgba(148, 194, 224, .25)";
  ctx.lineWidth = 1;
  roundRectPath(floor.x + 350, floor.y + floor.h + 14, 334, 32, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#dbeafe";
  ctx.font = "800 13px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.fillText("랙 번호 클릭: 고객사·CAPA 상세 확인", floor.x + 517, floor.y + floor.h + 35);
  ctx.restore();
}

function drawWarehouseShell(floor) {
  ctx.save();
  ctx.fillStyle = "#101f2c";
  ctx.strokeStyle = "rgba(125, 211, 252, .22)";
  ctx.lineWidth = 1.5;
  roundRectPath(floor.x - 22, floor.y - 34, floor.w + 44, floor.h + 82, 12);
  ctx.fill();
  ctx.stroke();

  const p = [
    [floor.x + 18, floor.y + floor.h - 28],
    [floor.x + 170, floor.y + 28],
    [floor.x + floor.w - 96, floor.y + 4],
    [floor.x + floor.w + 10, floor.y + floor.h - 52],
    [floor.x + 306, floor.y + floor.h + 28],
  ];
  ctx.fillStyle = "#6d7881";
  ctx.strokeStyle = "rgba(209, 222, 233, .72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  p.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(30, 41, 59, .45)";
  ctx.beginPath();
  ctx.moveTo(p[1][0], p[1][1]);
  ctx.lineTo(p[2][0], p[2][1]);
  ctx.lineTo(p[2][0] + 42, p[2][1] + 82);
  ctx.lineTo(p[1][0] - 28, p[1][1] + 58);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(148, 163, 184, .22)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i += 1) {
    const x = floor.x + 120 + i * 44;
    ctx.beginPath();
    ctx.moveTo(x, floor.y + 72);
    ctx.lineTo(x + 78, floor.y + floor.h - 12);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAisleLines(floor) {
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(250, 204, 21, .75)";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 6; i += 1) {
    const x = floor.x + 96 + i * 126;
    ctx.beginPath();
    ctx.moveTo(x, floor.y + 86);
    ctx.lineTo(x + 86, floor.y + floor.h - 52);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(124, 58, 237, .55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i += 1) {
    const x = floor.x + 145 + i * 125;
    ctx.beginPath();
    ctx.moveTo(x, floor.y + 74);
    ctx.bezierCurveTo(x + 30, floor.y + 200, x + 40, floor.y + 300, x + 92, floor.y + floor.h - 56);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDockArea(x, y) {
  ctx.save();
  ctx.fillStyle = "rgba(34, 197, 94, .20)";
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 38);
  ctx.lineTo(x + 88, y);
  ctx.lineTo(x + 168, y + 54);
  ctx.lineTo(x + 78, y + 92);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#dcfce7";
  ctx.font = "900 18px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.fillText("입/출고장", x + 84, y + 55);
  ctx.restore();
}

function drawBulkArea(x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(148, 163, 184, .16)";
  ctx.strokeStyle = "rgba(96, 165, 250, .84)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 30);
  ctx.lineTo(x + w - 42, y);
  ctx.lineTo(x + w, y + h - 40);
  ctx.lineTo(x + 44, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 9; i += 1) {
    const px = x + 34 + (i % 3) * 56;
    const py = y + 46 + Math.floor(i / 3) * 48;
    drawColumn(px, py, 10, 58);
  }
  drawTag(x + 72, y + 94, "BULK 평치 영역", "#475569");
  ctx.restore();
}

function drawWorkArea(x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(245, 158, 11, .18)";
  ctx.strokeStyle = "rgba(245, 158, 11, .85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 20);
  ctx.lineTo(x + w - 26, y);
  ctx.lineTo(x + w, y + h - 18);
  ctx.lineTo(x + 24, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 5; i += 1) {
    drawMiniCube(x + 36 + i * 32, y + 34, 18, 12, 8, "#b08955");
  }
  drawTag(x + 74, y + 20, "작업/기타 영역", "#a16207");
  ctx.restore();
}

function drawColumn(x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "#d8dee4";
  ctx.strokeStyle = "rgba(255,255,255,.36)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y - 6);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTag(x, y, text, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,.5)";
  ctx.lineWidth = 1;
  roundRectPath(x, y, ctx.measureText(text).width + 28, 30, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 15px Segoe UI, Malgun Gothic";
  ctx.textAlign = "left";
  ctx.fillText(text, x + 14, y + 20);
  ctx.restore();
}

function drawRackBlockLegend(x, y) {
  const items = [
    ["화주사 점유", "#ef4444"],
    ["부분 점유", "#fca5a5"],
    ["여유 CAPA", "#f8fafc"],
  ];
  ctx.save();
  ctx.font = "800 12px Segoe UI, Malgun Gothic";
  items.forEach((item, i) => {
    const bx = x + i * 120;
    ctx.fillStyle = item[1];
    ctx.strokeStyle = item[1] === "#f8fafc" ? "#94a3b8" : "rgba(255,255,255,.35)";
    roundRectPath(bx, y, 16, 16, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(226,232,240,.88)";
    ctx.fillText(item[0], bx + 22, y + 12);
  });
  ctx.restore();
}

function drawIsometricRack(x, y, rack) {
  const slots = 40;
  const usedSlots = Math.round(slots * Math.max(0, Math.min(100, rack.rate)) / 100);
  const customerColors = rack.customers.length ? rack.customers.map((item) => item.color) : ["#22c55e"];
  const colorBySlot = (index) => {
    if (index >= usedSlots) return "#f8fafc";
    return customerColors[index % customerColors.length];
  };

  ctx.save();
  ctx.globalAlpha = .24;
  ctx.fillStyle = "#020617";
  ctx.beginPath();
  ctx.ellipse(x + 58, y + 78, 92, 20, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const cubeW = 13;
  const cubeH = 8;
  const depth = 8;
  let slot = 0;
  for (let bay = 7; bay >= 0; bay -= 1) {
    for (let level = 4; level >= 0; level -= 1) {
      const cx = x + bay * 12 - level * 2;
      const cy = y + bay * 7 - level * 13;
      drawMiniCube(cx, cy, cubeW, cubeH, depth, colorBySlot(slot));
      slot += 1;
    }
  }

  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 2;
  for (let bay = 0; bay <= 8; bay += 2) {
    ctx.beginPath();
    ctx.moveTo(x + bay * 12 - 10, y + bay * 7 + 8);
    ctx.lineTo(x + bay * 12 - 18, y + bay * 7 - 58);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(191,219,254,.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 16, y + 4);
  ctx.lineTo(x + 94, y + 66);
  ctx.stroke();

  const rateColor = rack.rate >= 90 ? "#ef4444" : rack.rate >= 70 ? "#d59b18" : "#10b981";
  const labelW = 74;
  ctx.fillStyle = state.selectedKey === rack.key ? "#2563eb" : "rgba(15, 23, 42, .9)";
  ctx.strokeStyle = state.selectedKey === rack.key ? "#93c5fd" : "rgba(255,255,255,.35)";
  ctx.lineWidth = 1.2;
  roundRectPath(x - 8, y - 78, labelW, 26, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 14px Segoe UI, Malgun Gothic";
  ctx.textAlign = "center";
  ctx.fillText(`${String(rack.no).padStart(2, "0")}번 랙`, x + labelW / 2 - 8, y - 61);

  ctx.fillStyle = rateColor;
  roundRectPath(x + 16, y + 72, 56, 22, 11);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "900 12px Segoe UI, Malgun Gothic";
  ctx.fillText(`${Math.round(rack.rate)}%`, x + 44, y + 87);

  state.hitBoxes.push({
    key: rack.key,
    type: "rack",
    poly: [[x - 26, y - 92], [x + 120, y - 68], [x + 136, y + 96], [x - 18, y + 104]],
  });
  ctx.restore();
}

function drawMiniCube(x, y, w, h, d, color) {
  const isEmpty = color === "#f8fafc";
  ctx.save();
  ctx.strokeStyle = isEmpty ? "rgba(148,163,184,.9)" : "rgba(255,255,255,.35)";
  ctx.lineWidth = .8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = shadeColor(color, isEmpty ? -8 : -18);
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w + d, y - d * .55);
  ctx.lineTo(x + w + d, y + h - d * .55);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = shadeColor(color, isEmpty ? 8 : 16);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + d, y - d * .55);
  ctx.lineTo(x + w + d, y - d * .55);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function shadeColor(color, amount) {
  if (!color || !color.startsWith("#") || color.length !== 7) return color;
  const n = parseInt(color.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function tooltipHtml(key) {
  const rack = getRack(key);
  if (!rack) return "";
  return `
    <strong>${String(rack.no).padStart(2, "0")}번 랙</strong>
    <span>사용 ${fmt(rack.used)} PLT / CAPA ${fmt(rack.capa)} PLT</span>
    <span>여유 ${fmt(rack.empty)} PLT · 점유율 ${pct(rack.rate)}</span>
  `;
}

function renderRackInfo(rack) {
  const used = Math.max(1, rack.used);
  selectedInfo.innerHTML = `
    <span>선택 랙 정보</span>
    <strong style="color:${rack.color}">${String(rack.no).padStart(2, "0")}번 랙 · ${rack.status}</strong>
    <p>${String(rack.no).padStart(2, "0")}번 랙은 현재 ${fmt(rack.used)} PLT 사용 중이며, 여유 CAPA는 ${fmt(rack.empty)} PLT입니다.</p>
    <dl>
      <div><dt>CAPA</dt><dd>${fmt(rack.capa)} PLT</dd></div>
      <div><dt>사용</dt><dd>${fmt(rack.used)} PLT</dd></div>
      <div><dt>여유</dt><dd>${fmt(rack.empty)} PLT</dd></div>
      <div><dt>사용률</dt><dd>${pct(rack.rate)}</dd></div>
      <div><dt>엑셀 셀</dt><dd>${fmt(rack.excelCells)}개</dd></div>
    </dl>
    <table class="rack-detail">
      <thead><tr><th>화주사</th><th>보관 PLT</th><th>비중</th></tr></thead>
      <tbody>
        ${rack.customers.map((item) => `
          <tr>
            <td><i style="background:${item.color}"></i>${item.name}</td>
            <td>${fmt(item.plt)}</td>
            <td>${pct(item.plt / used * 100)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

setup();
