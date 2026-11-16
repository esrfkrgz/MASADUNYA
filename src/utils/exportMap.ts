import type { MapLocation, MapRoute } from '../types/map';

export function exportCampaignJson(locations: MapLocation[], routes: MapRoute[], partyLocationId: string) {
  const payload = {
    region: 'Kadim Sis Ormanı — Doğu Yakası',
    exportedAt: new Date().toISOString(),
    partyLocationId,
    locations,
    routes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kadim-sis-ormani-harita.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportMapPng(
  mapImageSrc: string,
  locations: MapLocation[],
  routes: MapRoute[],
  partyLocationId: string,
  fogOfWar: boolean
) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Harita görseli yüklenemedi.'));
    img.src = mapImageSrc;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 1600;
  canvas.height = img.naturalHeight || 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Subtle parchment border vignette
  ctx.strokeStyle = 'rgba(212, 168, 83, 0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  // Routes
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(212, 168, 83, 0.78)';
  for (const rt of routes) {
    const from = locations.find((l) => l.id === rt.fromId);
    const to = locations.find((l) => l.id === rt.toId);
    if (!from || !to) continue;
    if (fogOfWar && (!from.discovered || !to.discovered)) continue;
    ctx.beginPath();
    ctx.moveTo((from.x / 100) * canvas.width, (from.y / 100) * canvas.height);
    ctx.lineTo((to.x / 100) * canvas.width, (to.y / 100) * canvas.height);
    ctx.stroke();
  }
  ctx.restore();

  // Pins & labels
  for (const loc of locations) {
    if (fogOfWar && !loc.discovered) continue;
    const cx = (loc.x / 100) * canvas.width;
    const cy = (loc.y / 100) * canvas.height;
    const isParty = loc.id === partyLocationId;

    ctx.beginPath();
    ctx.arc(cx, cy, isParty ? 14 : 10, 0, Math.PI * 2);
    ctx.fillStyle = isParty ? '#D4A853' : '#182420';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isParty ? '#FFF8E7' : '#D4A853';
    ctx.stroke();

    // Label banner
    ctx.font = '600 18px Georgia, serif';
    const textWidth = ctx.measureText(loc.name).width;
    ctx.fillStyle = 'rgba(13, 21, 18, 0.86)';
    ctx.fillRect(cx - textWidth / 2 - 10, cy + 18, textWidth + 20, 28);
    ctx.strokeStyle = 'rgba(212, 168, 83, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - textWidth / 2 - 10, cy + 18, textWidth + 20, 28);

    ctx.fillStyle = '#F5EFE0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loc.name, cx, cy + 32);
  }

  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'kadim-sis-ormani-jrpg-harita.png';
  a.click();
}
