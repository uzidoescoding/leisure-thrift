import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- PSX-flavoured helpers ----------
// vertex snapping = the PS1 "wobble"
const snap = s => {
  s.vertexShader = s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    gl_Position.xy = floor(gl_Position.xy / gl_Position.w * 170. + .5) / 170. * gl_Position.w;`);
};
const matCache = new Map();
const mat = (color, map) => {
  if (!map && matCache.has(color)) return matCache.get(color);
  const m = new THREE.MeshLambertMaterial({ color, map, flatShading: true });
  m.onBeforeCompile = snap;
  if (!map) matCache.set(color, m);
  return m;
};
const glow = (color, map) => new THREE.MeshBasicMaterial({ color, map });

function tex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function noise(g, w, h, a) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * a})`;
    g.fillRect(x, y, 1, 1);
  }
}
function label(w, h, bg, fg, lines, px) {
  return tex(w, h, g => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `${px}px "Press Start 2P", monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, w / 2, h * (i + .5) / lines.length + 1));
  });
}

// ---------- scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x191320);
const camera = new THREE.PerspectiveCamera(40, 1, .1, 100);

function box(w, h, d, m, x, y, z, parent = scene) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
function cyl(rt, rb, h, seg, m, x, y, z, parent = scene) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
function addLights(s) {
  s.add(new THREE.AmbientLight(0xffe6c4, 2.1));
  const d = new THREE.DirectionalLight(0xfff2dd, 2.2);
  d.position.set(4, 10, 9);
  s.add(d);
}
addLights(scene);

// ---------- assets ----------
const [penguinModel] = await Promise.all([
  new GLTFLoader().loadAsync('assets/models/penguin.glb').then(g => g.scene),
  Promise.race([document.fonts.load('8px "Press Start 2P"'), new Promise(r => setTimeout(r, 2000))]),
]);

// ---------- garment textures ----------
// Body faces are 128x156 pixel canvases: either cropped from a product photo or drawn here.
const TW = 128, TH = 156;
const face = draw => tex(TW, TH, draw);
const cloth = (g, c) => { g.fillStyle = c; g.fillRect(0, 0, g.canvas.width, g.canvas.height); noise(g, g.canvas.width, g.canvas.height, .06); };

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// photo -> small pixel texture. crop = [x, y, w, h] in fractions; shape clips it (rounded decks)
async function shot(src, w, h, crop = [0, 0, 1, 1], shape) {
  const img = await loadImg(src);
  return tex(w, h, g => {
    if (shape) { shape(g); g.clip(); }
    g.drawImage(img, crop[0] * img.width, crop[1] * img.height, crop[2] * img.width, crop[3] * img.height, 0, 0, w, h);
  });
}
// crop = [x, y, width] of the shirt body in the photo, as fractions of the image
async function photo(src, [fx, fy, fw]) {
  const img = await loadImg(src);
  let fabric;
  const t = face((g, w, h) => {
    const sw = fw * img.width;
    g.drawImage(img, fx * img.width, fy * img.height, sw, sw * h / w, 0, 0, w, h);
    const d = g.getImageData(4, h - 5, 1, 1).data; // cloth colour for sleeves / back
    fabric = '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('');
  });
  return { t, fabric };
}

// Hand-drawn stand-ins for prints (used where there is no product photo on disk yet).
function crossPatch(g, x, y, s, ink) {
  g.save(); g.translate(x, y); g.fillStyle = ink;
  for (let k = 0; k < 4; k++) {
    g.beginPath(); g.moveTo(-.14 * s, 0); g.lineTo(-.36 * s, -s); g.lineTo(.36 * s, -s); g.lineTo(.14 * s, 0); g.fill();
    g.rotate(Math.PI / 2);
  }
  g.restore();
}
function horseshoe(g, cx, cy, r, ink, bg, cross) {
  g.strokeStyle = ink; g.lineWidth = r * .42;
  g.beginPath(); g.arc(cx, cy, r, Math.PI * .64, Math.PI * .36); g.stroke();
  g.strokeStyle = bg; g.lineWidth = r * .2; g.setLineDash([r * .13, r * .1]); // reads as lettering at this size
  g.beginPath(); g.arc(cx, cy, r, Math.PI * .7, Math.PI * .3); g.stroke(); g.setLineDash([]);
  g.fillStyle = ink;
  for (const s of [-1, 1]) g.fillRect(cx + s * r * .43 - r * .26, cy + r * .84, r * .52, r * .28);
  if (cross) crossPatch(g, cx, cy, r * .5, ink);
}
function script(g, text, x, y, px, ink) {
  g.save(); g.translate(x, y); g.rotate(-.12);
  g.fillStyle = ink; g.font = `italic bold ${px}px "Segoe Script", "Brush Script MT", cursive`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 0);
  g.restore();
}
function eightBall(g, cx, cy, r) {
  const gr = g.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r);
  gr.addColorStop(0, '#bdbdbd'); gr.addColorStop(1, '#3a3a3a');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.fillStyle = '#e8e8e8'; g.beginPath(); g.arc(cx - r * .25, cy - r * .15, r * .3, 0, 7); g.fill();
  g.fillStyle = '#222'; g.font = `bold ${r * .45}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('8', cx - r * .25, cy - r * .13);
  g.fillStyle = '#c8c8c8'; // figure slumped on top, with wings
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * r * .2, cy - r * 1.1); g.lineTo(cx + s * r * .95, cy - r * 1.55); g.lineTo(cx + s * r * .7, cy - r * .85); g.fill(); }
  g.fillStyle = '#9a9a9a'; g.beginPath(); g.ellipse(cx, cy - r, r * .55, r * .28, 0, 0, 7); g.fill();
  g.fillStyle = '#b0b0b0'; g.beginPath(); g.arc(cx + r * .1, cy - r * 1.25, r * .2, 0, 7); g.fill();
}
const sleeveText = (text, bg, dir) => tex(40, 124, (g, w, h) => {
  cloth(g, bg);
  g.translate(w / 2, h * .58); g.rotate(dir * Math.PI / 2);
  g.fillStyle = '#f4f4f4'; g.font = 'bold 21px "Old English Text MT", "UnifrakturCook", Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 1);
});
function denim(g) {
  const w = g.canvas.width, h = g.canvas.height;
  g.fillStyle = '#86a8cc'; g.fillRect(0, 0, w, h);
  const fade = g.createLinearGradient(0, 0, w, 0); // worn-in stripe down the middle
  fade.addColorStop(0, 'rgba(210,226,240,0)'); fade.addColorStop(.5, 'rgba(210,226,240,.75)'); fade.addColorStop(1, 'rgba(210,226,240,0)');
  g.fillStyle = fade; g.fillRect(0, 0, w, h);
  noise(g, w, h, .14);
}

function stussy8(fabric, ink) {
  return {
    type: 'tee', fabric,
    front: face(g => { cloth(g, fabric); script(g, 'Stussy', 88, 44, 13, ink); }),
    back: face(g => { cloth(g, fabric); script(g, 'Stussy', 64, 34, 30, ink); eightBall(g, 64, 110, 30); }),
  };
}
function raglan(sleeve, ink) {
  const fabric = '#eeeeec';
  const shoulders = g => { // raglan seams run from collar to armpit
    cloth(g, fabric); g.fillStyle = sleeve;
    for (const s of [0, 1]) { g.beginPath(); g.moveTo(s * TW, 0); g.lineTo(s * TW + (s ? -36 : 36), 0); g.lineTo(s * TW, 56); g.fill(); }
  };
  return {
    type: 'long', fabric, sleeve, collar: sleeve,
    front: face(g => { shoulders(g); horseshoe(g, 88, 52, 11, ink, fabric); }),
    back: face(shoulders),
    sleeveTex: [sleeveText('CHROME', sleeve, -1), sleeveText('HEARTS', sleeve, 1)],
  };
}
const CH_BLACK = '#131313';
const jeansLeg = marks => tex(44, 112, g => { denim(g); marks.forEach(([x, y, s]) => crossPatch(g, x, y, s, '#15151a')); });

const deckShape = g => { g.beginPath(); g.roundRect(0, 0, 36, 144, 18); };
const [acne, stussy, margiela, rugTex, posterTex, deckA, deckB, camoHead, camoBody, varHead, varBody, cashierImg] = await Promise.all([
  photo('assets/acne.png', [.26, .17, .48]),
  photo('assets/stussy.png', [.24, .21, .53]),
  photo('assets/margiela.png', [.27, .215, .46]),
  shot('assets/props/rug.webp', 128, 128, [.026, .043, .948, .948]),
  shot('assets/props/poster.webp', 128, 172),
  shot('assets/props/decks.png', 36, 144, [.149, .008, .321, .987], deckShape),
  shot('assets/props/decks.png', 36, 144, [.512, .008, .332, .987], deckShape),
  shot('assets/props/bear-camo.webp', 48, 40, [.21, .12, .61, .27]),      // head
  shot('assets/props/bear-camo.webp', 40, 32, [.27, .40, .46, .26]),      // body
  shot('assets/props/bear-varsity.webp', 48, 40, [.355, .09, .29, .30]),
  shot('assets/props/bear-varsity.webp', 40, 32, [.365, .385, .27, .265]),
  loadImg('assets/props/cashier.webp'),                                  // cashier reference
]);

// ---------- catalogue ----------
// A product with more than one variant gets a colour option in the pop-up.
const CHARTS = {
  top: { cols: ['Chest', 'Length'], rows: { S: [46, 66], M: [51, 70], L: [56, 74], XL: [61, 77] } },
  jeans: { cols: ['Waist', 'Inseam'], rows: { 28: [71, 79], 30: [76, 81], 32: [81, 81], 34: [86, 84] } },
};
const SHIPPING = 8;
const PRODUCTS = [
  { brand: 'Acne Studios', name: 'Stockholm 1996 Long Sleeve', price: 120, variants: [{ color: 'White', type: 'long', fabric: acne.fabric, front: acne.t }] },
  { brand: 'Stussy', name: 'Basic Logo Tee', price: 45, variants: [{ color: 'Black', type: 'tee', fabric: stussy.fabric, front: stussy.t }] },
  { brand: 'Maison Margiela', name: 'Numbers Logo Tee', price: 160, variants: [{ color: 'Black', type: 'tee', fabric: margiela.fabric, back: margiela.t }] },
  { brand: 'Stussy', name: '8 Ball Angel Tee', price: 55, variants: [{ color: 'White', ...stussy8('#f1f1ee', '#1a1a1a') }, { color: 'Black', ...stussy8('#141414', '#d9d9d9') }] },
  { brand: 'Chrome Hearts', name: 'Horseshoe Raglan Long Sleeve', price: 320, variants: [{ color: 'Blue', ...raglan('#2f5fc4', '#1d3f9a') }, { color: 'Black', ...raglan('#151515', '#151515') }] },
  { brand: 'Chrome Hearts', name: 'Horseshoe Pocket Tee', price: 280, variants: [{
    color: 'Black', type: 'tee', fabric: CH_BLACK,
    front: face(g => { cloth(g, CH_BLACK); g.strokeStyle = '#2c2c2c'; g.strokeRect(73.5, 34.5, 36, 40); horseshoe(g, 91, 52, 10, '#f2f2f2', CH_BLACK); }),
    back: face(g => { cloth(g, CH_BLACK); horseshoe(g, 64, 70, 38, '#f2f2f2', CH_BLACK, true); }),
  }] },
  { brand: 'Chrome Hearts', name: 'Cross Patch Denim', price: 950, chart: 'jeans', variants: [{
    color: 'Light Wash', type: 'jeans', fabric: '#86a8cc',
    front: tex(96, 48, g => {
      denim(g); g.strokeStyle = '#5f7fa6'; g.lineWidth = 1;
      g.strokeRect(-1, .5, 98, 8);                                                        // waistband
      for (const x of [14, 34, 62, 82]) g.strokeRect(x + .5, 0, 3, 9);                     // belt loops
      g.beginPath(); g.moveTo(48.5, 9); g.lineTo(48.5, 48); g.moveTo(49, 12); g.quadraticCurveTo(60, 30, 49, 44); g.stroke(); // fly
      for (const s of [0, 1]) { g.beginPath(); g.arc(s * 96, 9, 22, 0, 7); g.stroke(); }   // pockets
      g.fillStyle = '#c9c9c9'; g.fillRect(47, 3, 3, 3);
      crossPatch(g, 22, 32, 10, '#15151a'); crossPatch(g, 76, 28, 8, '#15151a');
    }),
    back: tex(96, 48, g => {
      denim(g); g.strokeStyle = '#5f7fa6'; g.strokeRect(-1, .5, 98, 8);
      for (const x of [12, 56]) g.strokeRect(x + .5, 16.5, 28, 26);
    }),
    legs: [jeansLeg([[16, 24, 9], [14, 62, 8], [28, 100, 8]]), jeansLeg([[20, 34, 10], [30, 92, 9]])],
  }] },
];
const VARIANTS = PRODUCTS.flatMap(p => p.variants.map(v => Object.assign(v, { product: p })));

// ---------- room: 3 walls, no roof, no front wall ----------
const W = 12, D = 10, H = 4.2;
const trim = mat(0x4a2f22), wood = mat(0x8a5b3c), woodLight = mat(0xb98352), metal = mat(0x9a9aa6);

const floorTex = tex(16, 16, (g, w, h) => {
  g.fillStyle = '#d8b97e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b77f4a'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  noise(g, w, h, .12);
}, [W / 2, D / 2]);
box(W + .6, .4, D + .3, [trim, trim, mat(0xffffff, floorTex), trim, trim, trim], 0, -.2, -.15);

const wallTex = rep => tex(32, 64, (g, w, h) => {
  g.fillStyle = '#e2cfa6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3f7f86'; g.fillRect(0, 36, w, 4);
  g.fillStyle = '#8a5b3c'; g.fillRect(0, 40, w, 24);
  g.fillStyle = '#6a4129';
  for (let x = 0; x < w; x += 8) g.fillRect(x, 40, 1, 24);
  g.fillRect(0, 40, w, 1); g.fillRect(0, 60, w, 4);
  noise(g, w, h, .08);
}, [rep, 1]);
const back = mat(0xffffff, wallTex(6)), side = mat(0xffffff, wallTex(5));
box(W + .6, H, .3, [trim, trim, trim, trim, back, trim], 0, H / 2, -D / 2 - .15);
box(.3, H, D, [side, trim, trim, trim, trim, trim], -W / 2 - .15, H / 2, 0);
box(.3, H, D, [trim, side, trim, trim, trim, trim], W / 2 + .15, H / 2, 0);

// sign + posters
box(5.4, .8, .12, [trim, trim, trim, trim, glow(0xffffff, label(320, 48, '#2a1830', '#ff8fb1', ['LEISURE THRIFT'], 20)), trim], 0, 3.6, -D / 2 + .06);
box(1.1, .95, .06, [trim, trim, trim, trim, mat(0xffffff, label(64, 56, '#3f7f86', '#fff6de', ['OPEN', '24-7'], 8)), trim], 4.9, 3.55, -D / 2 + .03);

// round rug in the middle (texture from the rug photo)
{
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.4, 18), mat(0xffffff, rugTex));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, .04, .6);
  scene.add(rug);
}

// ---------- back wall: poster, decks, the till, a cashier and a shelf of figures ----------
const BACK = -D / 2;
const f6 = (c, front) => [c, c, c, c, front ? mat(0xffffff, front) : c, c]; // box materials, texture on the front
const posterMesh = box(1.9, 2.55, .08, f6(trim, posterTex), -3.95, 2.05, BACK + .04); // click to view the real image
[deckA, deckB].forEach((t, i) => {
  const m = glow(0xe6e6e6, t); m.alphaTest = .5;
  const d = new THREE.Mesh(new THREE.PlaneGeometry(.55, 2.2), m);
  d.position.set(-2.35 + i * .7, 2.0, BACK + .06);
  scene.add(d);
});

// big counter + register - also the checkout spot
const COUNTER = new THREE.Vector3(1.2, 0, -3.6), TILL_X = COUNTER.x - .9;
{
  const g = new THREE.Group(); g.position.copy(COUNTER); scene.add(g);
  box(5, 1.1, 1.1, wood, 0, .55, 0, g);
  box(5.2, .1, 1.3, woodLight, 0, 1.15, 0, g);
  box(5, .16, .04, mat(0x3f7f86), 0, .8, .57, g);
  box(.7, .35, .55, mat(0x5a5a66), -1.8, 1.38, 0, g);
  box(.5, .32, .08, glow(0x7dffb0), -1.8, 1.7, -.15, g).rotation.x = -.3;
  box(.4, .22, .35, mat(0xd9523f), 0, 1.31, .2, g); // tip tin
}

// cashier: PSX-style character modelled on the reference image. The head is a sculpted
// low-poly mesh (jaw, nose, ears) with the face wrapped onto it as a texture, the way
// PS1 characters were built. Grey knit sweater, white collar, blue jeans, white watch.
const cashier = new THREE.Group(), cashierHead = new THREE.Group();
{
  const SKIN = '#8a5b3d', HAIR = '#17120f', skin = mat(SKIN), jeans = mat('#4f6fa8');
  const knit = tex(16, 16, g => {
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) {
      const v = 88 + (Math.random() * 44 | 0);
      g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(x, y, 4, 4);
    }
  });
  const sweater = mat(0xffffff, knit);

  // face texture: skin base, hair wrapping round the sides, then the levelled face feathered in
  const headTex = tex(64, 80, (g, w, h) => {
    g.fillStyle = SKIN; g.fillRect(0, 0, w, h);
    g.fillStyle = HAIR; g.beginPath();
    [[0, 0], [1, 0], [1, .55], [.87, .42], [.8, .2], [.2, .2], [.13, .42], [0, .55]]
      .forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
    g.fill();
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    const c = o.getContext('2d'), s = w * .84 / 340;       // the face is ~340px wide in the photo
    c.translate(w / 2, h / 2); c.rotate(.31); c.scale(s, s); // undo the head tilt
    c.drawImage(cashierImg, -530, -490);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-in';          // soft oval mask so the edges melt into skin/hair
    c.translate(w / 2, h / 2); c.scale(w * .42, h * .48);
    const fade = c.createRadialGradient(0, 0, .72, 0, 0, 1);
    fade.addColorStop(0, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fade; c.fillRect(-2, -2, 4, 4);
    g.drawImage(o, 0, h * .03);
  });
  const backTex = tex(2, 16, g => { g.fillStyle = SKIN; g.fillRect(0, 0, 2, 16); g.fillStyle = HAIR; g.fillRect(0, 0, 2, 9); });

  // sculpt a unit sphere half into a head: tapered jaw, flatter face, nose bump
  const headHalf = (front) => {
    const geo = new THREE.SphereGeometry(1, 6, 8, front ? 0 : Math.PI, Math.PI), p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      uv.setXY(i, front ? x * .5 + .5 : .5, y * .5 + .5);   // face projected from the front
      if (y < 0) { x *= 1 - .3 * y * y; z *= 1 + .1 * y; }
      if (z > 0) z = z * .92 + Math.max(0, 1 - Math.hypot(x / .24, (y + .12) / .3)) * .2;
      p.setXYZ(i, x * .175, y * .23, z * .195);
    }
    const m = new THREE.Mesh(geo, mat(0xffffff, front ? headTex : backTex));
    m.position.y = .23;
    cashierHead.add(m);
  };
  headHalf(true); headHalf(false);
  for (const s of [-1, 1]) box(.04, .09, .06, skin, s * .178, .22, -.01, cashierHead); // ears

  for (const s of [-1, 1]) {
    cyl(.13, .15, .85, 6, jeans, s * .16, .47, 0, cashier);            // legs
    box(.26, .12, .4, mat('#e8e8e8'), s * .16, .06, .05, cashier);     // shoes
    const arm = cyl(.1, .085, .72, 6, sweater, s * .43, 1.22, 0, cashier); // long sleeves
    arm.rotation.z = s * .08;
    box(.13, .14, .14, skin, s * .46, .8, 0, cashier);                 // hands
  }
  cyl(.1, .1, .07, 6, mat('#ededed'), .455, .9, 0, cashier);           // watch
  cyl(.3, .34, .75, 8, sweater, 0, 1.25, 0, cashier).scale.z = .58;    // torso
  cyl(.15, .2, .06, 8, mat('#ededed'), 0, 1.64, 0, cashier).scale.z = .7; // collar
  cyl(.075, .085, .14, 6, skin, 0, 1.69, 0, cashier);                  // neck
  cashierHead.position.set(0, 1.72, 0);
  cashier.add(cashierHead);
  cashier.scale.setScalar(.95);
  cashier.position.set(TILL_X, 0, BACK + .5);
  scene.add(cashier);
}

// 3D collectible figures on a wall shelf, facing into the room
function makeBear({ head, body, skin, side, arm, leg, hand, shoe }) {
  const g = new THREE.Group(), S = mat(skin);
  for (const s of [-1, 1]) {
    box(.19, .32, .22, mat(leg), s * .115, .16, 0, g);
    if (shoe) box(.21, .1, .27, mat(shoe), s * .115, .05, .02, g);
    box(.13, .36, .16, mat(arm), s * .3, .5, 0, g);
    box(.14, .11, .17, mat(hand), s * .3, .27, 0, g);
    cyl(.12, .12, .09, 8, S, s * .25, 1.11, 0, g).rotation.x = Math.PI / 2; // ears
  }
  box(.44, .34, .26, f6(mat(side), body), 0, .49, 0, g);
  box(.56, .42, .44, f6(S, head), 0, .88, 0, g);
  return g;
}
function makeSitter() { // grey figure sitting on a block, hands over its face
  const g = new THREE.Group(), grey = mat('#9a9c9c'), dark = mat('#6f7070'), light = mat('#b9bbbb');
  const glove = tex(8, 10, c => {
    c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, 8, 10);
    c.strokeStyle = '#222'; c.beginPath(); c.moveTo(2, 3); c.lineTo(6, 7); c.moveTo(6, 3); c.lineTo(2, 7); c.stroke();
  });
  box(.44, .28, .36, mat('#2a2f3a'), 0, .14, 0, g);              // block
  box(.38, .16, .3, dark, 0, .36, 0, g);                         // shorts
  box(.36, .3, .24, grey, 0, .58, 0, g);                         // torso
  for (const s of [-1, 1]) {
    box(.16, .14, .34, grey, s * .11, .36, .2, g);               // thighs
    box(.16, .3, .16, grey, s * .11, .17, .38, g);               // shins
    box(.2, .12, .3, dark, s * .11, .06, .44, g);                // shoes
    box(.1, .28, .1, grey, s * .15, .72, .14, g).rotation.x = -.5; // arms raised
    box(.13, .17, .06, f6(mat('#f4f4f4'), glove), s * .07, .88, .22, g);
    for (const [ex, ey] of [[.2, .98], [.24, .86]]) {
      const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(.085, 0), light);
      ear.position.set(s * ex, ey, 0); g.add(ear);
    }
  }
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.19, 1), light);
  head.position.set(0, .88, .02); g.add(head);
  return g;
}
box(3.4, .08, .5, woodLight, COUNTER.x + 1.6, 2.2, BACK + .27);
[
  makeBear({ head: camoHead, body: camoBody, skin: '#151515', side: '#4a4636', arm: '#6b6248', leg: '#141414', hand: '#141414' }),
  makeBear({ head: varHead, body: varBody, skin: '#8b5e3c', side: '#9aa3b5', arm: '#f2f2f2', leg: '#2f67a8', hand: '#8b5e3c', shoe: '#b9bcc4' }),
  makeSitter(),
].forEach((f, i) => {
  f.scale.setScalar(i < 2 ? .7 : .85);
  f.position.set(COUNTER.x + .5 + i * 1.1, 2.24, BACK + .3);
  f.rotation.y = (i - 1) * -.18;
  scene.add(f);
});
// floor lamp
cyl(.28, .28, .06, 6, metal, -5.3, .03, 2.8);
cyl(.04, .04, 2.3, 5, metal, -5.3, 1.15, 2.8);
{
  const shade = new THREE.Mesh(new THREE.ConeGeometry(.45, .5, 6, 1, true), glow(0xffd98a));
  shade.material.side = THREE.DoubleSide;
  shade.position.set(-5.3, 2.4, 2.8); scene.add(shade);
  const l = new THREE.PointLight(0xffb060, 7, 9);
  l.position.set(-5, 2.3, 2.8); scene.add(l);
}
// plant + crate of folded clothes (front-right)
cyl(.32, .22, .5, 6, mat(0xb5562f), 4.6, .25, 3.9);
for (let i = 0; i < 4; i++) {
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(.22, 1.1, 4), mat(0x2f8a4a));
  leaf.position.set(4.6, .95, 3.9);
  leaf.rotation.set(Math.cos(i * 1.6) * .45, 0, Math.sin(i * 1.6) * .45);
  scene.add(leaf);
}
const FOLD = [0xd9523f, 0x3f7f86, 0xf4e4c1, 0x1c1c22, 0x5b4bb5, 0xe2a53a];
const pile = (x, y, z, n) => { for (let i = 0; i < n; i++) box(.55, .09, .45, mat(FOLD[Math.random() * FOLD.length | 0]), x, y + i * .1, z); };
box(1, .6, 1, mat(0xb8905a), 3.6, .3, 4.2);
pile(3.4, .65, 4.15, 3); pile(3.85, .65, 4.3, 2);
// folded stock on the counter and a bench by the lamp
pile(COUNTER.x + 1.3, 1.25, COUNTER.z, 3); pile(COUNTER.x + 2, 1.25, COUNTER.z + .1, 2);
box(1.8, .45, .6, wood, -4.6, .225, 4.2);
pile(-5, .5, 4.2, 2); pile(-4.3, .5, 4.2, 3);

// ---------- low-poly garments (racks, pop-up 360 view and checkout display) ----------
const FACE_W = .95, FACE_H = 1.15, GREEN = 0x39ff6a;
// hover outline: inverted hulls, one crisp and one soft additive halo
const hullLine = new THREE.MeshBasicMaterial({ color: GREEN, side: THREE.BackSide });
const hullGlow = new THREE.MeshBasicMaterial({ color: GREEN, side: THREE.BackSide, transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending });

function makeGarment(v) {
  const g = new THREE.Group(), c = mat(v.fabric), hull = [];
  const faces = (front, back) => [c, c, c, c, front ? mat(0xffffff, front) : c, back ? mat(0xffffff, back) : c];
  const part = (w, h, d, m, x, y, z, parent) => {
    box(w, h, d, m, x, y, z, parent);
    for (const [grow, hm] of [[.07, hullLine], [.22, hullGlow]]) {
      const o = box(w + grow, h + grow, d + grow, hm, x, y, z, parent);
      o.visible = false;
      hull.push(o);
    }
  };
  box(.03, .16, .03, metal, 0, -.06, 0, g);            // hook
  box(.72, .04, .05, woodLight, 0, -.15, 0, g);        // hanger
  if (v.type === 'jeans') {
    part(.74, .36, .16, faces(v.front, v.back), 0, -.35, 0, g);
    [-1, 1].forEach((s, i) => {
      const leg = new THREE.Group();
      leg.position.set(s * .19, -.5, 0); leg.rotation.z = s * .05;
      part(.35, .95, .15, faces(v.legs[i], v.legs[1 - i]), 0, -.475, 0, leg);
      g.add(leg);
    });
  } else {
    const sl = mat(v.sleeve || v.fabric), long = v.type === 'long', len = long ? 1.05 : .45;
    part(FACE_W, FACE_H, .14, faces(v.front, v.back), 0, -.75, 0, g);
    part(.34, .07, .16, mat(v.collar || v.fabric), 0, -.16, 0, g);
    [-1, 1].forEach((s, i) => {
      const arm = new THREE.Group();
      arm.position.set(s * .42, -.22, 0);
      arm.rotation.z = s * (long ? .25 : .95);
      part(.34, len, .12, v.sleeveTex ? [sl, sl, sl, sl, mat(0xffffff, v.sleeveTex[i]), sl] : sl, 0, -len / 2 + .08, 0, arm);
      g.add(arm);
    });
  }
  g.userData.hull = hull;
  return g;
}

const RAIL = 3, SHIRT = 1.3, slots = [];
function addRack(len, x, z, rotY, xs) {
  const r = new THREE.Group();
  r.position.set(x, 0, z); r.rotation.y = rotY; scene.add(r);
  cyl(.045, .045, len, 6, metal, 0, RAIL, 0, r).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    cyl(.05, .05, RAIL, 6, metal, s * len / 2, RAIL / 2, 0, r);
    box(.5, .06, .5, metal, s * len / 2, .03, 0, r);
  }
  // side racks: angle the pieces toward the camera so the prints read
  xs.forEach(lx => slots.push({ r, lx, tilt: -Math.sign(rotY) * .55 }));
}
addRack(6.6, -5.35, -.9, Math.PI / 2, [-2.9, -1.74, -.58, .58, 1.74, 2.9]);
addRack(6, 5.35, -.7, -Math.PI / 2, [-2.6, -1.3, 0, 1.3, 2.6]); // the back wall belongs to the till and props

// randomised stock: every variant appears at least once
// ponytail: sort-random shuffle is biased, fine for set dressing
const stock = [...VARIANTS, ...slots.map(() => VARIANTS[Math.random() * VARIANTS.length | 0])]
  .slice(0, slots.length).sort(() => Math.random() - .5);
const items = slots.map((s, i) => {
  const group = makeGarment(stock[i]);
  group.position.set(s.lx, RAIL, 0);
  group.rotation.y = s.tilt;
  s.r.add(group);
  const item = { variant: stock[i], group, h: 0, lit: false, phase: Math.random() * 6 };
  group.userData.item = item;
  return item;
});
const pickable = items.map(i => i.group);

// ---------- penguin (modelled in Blender: tools/penguin.py) ----------
const peng = new THREE.Group();
peng.scale.setScalar(.85); peng.position.set(0, .1, 1.2); scene.add(peng);
penguinModel.traverse(o => {
  if (!o.isMesh) return;
  o.material = mat(o.material.color.getHex());
  o.material.side = THREE.DoubleSide;
});
peng.add(penguinModel);
const body = penguinModel.getObjectByName('Body');
const wings = ['Wing_L', 'Wing_R'].map(n => penguinModel.getObjectByName(n));
const feet = ['Foot_L', 'Foot_R'].map(n => penguinModel.getObjectByName(n));
const footZ = feet[0].position.z;
const shadow = new THREE.Mesh(new THREE.CircleGeometry(.6, 10), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .28 }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = .06; peng.add(shadow);

// walkable area: inside the racks, around the front-corner props
const OBST = [[-4.6, 4.2, 1.2], [3.6, 4.2, 1.05], [4.6, 3.9, .75]];
function constrain(p) {
  p.x = clamp(p.x, -4.5, 4.5); p.z = clamp(p.z, -3.4, 4.4);
  if (Math.abs(p.x - COUNTER.x) < 3 && p.z < -2.5) p.z = -2.5; // stay in front of the counter
  for (const [ox, oz, r] of OBST) {
    const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz) || 1e-3;
    if (d < r) { p.x = ox + dx / d * r; p.z = oz + dz / d * r; }
  }
  return p;
}
{ // self-check: points inside the bench and the counter get pushed out
  const p = constrain({ x: -4.5, z: 4.2 }), q = constrain({ x: COUNTER.x, z: COUNTER.z });
  console.assert(Math.hypot(p.x + 4.6, p.z - 4.2) > 1.19 && q.z === -2.5, 'constrain() should push out of obstacles');
}

// ---------- 360 view: the same low-poly piece, spinning ----------
const spinCanvas = $('spin');
const spinR = new THREE.WebGLRenderer({ canvas: spinCanvas, antialias: false, alpha: true });
const spinScene = new THREE.Scene(), spinCam = new THREE.PerspectiveCamera(30, 1, .1, 20), spinPivot = new THREE.Group();
addLights(spinScene); spinScene.add(spinPivot); spinCam.position.z = 3.6;
function fitSpin() {
  const w = spinCanvas.clientWidth, h = spinCanvas.clientHeight;
  if (!w || !h) return;
  const ih = zoomed ? 320 : 170; // chunky pixels, a little finer when enlarged
  spinR.setSize(Math.round(ih * w / h), ih, false);
  spinCam.aspect = w / h;
  spinCam.updateProjectionMatrix();
}
function preview(v) {
  if (v.preview) return v.preview;
  const m = makeGarment(v), holder = new THREE.Group();
  const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const k = 1.6 / Math.max(s.x, s.y); // centre and normalise so every piece fills the view
  m.scale.setScalar(k);
  m.position.copy(c).multiplyScalar(-k);
  holder.add(m);
  return v.preview = holder;
}

// ---------- UI state ----------
const panel = $('panel'), checkout = $('checkout'), tag = $('tag'), toastEl = $('toast'), sizes = $('sizes');
let hovered = null, active = null, cur = null, toastTimer, zoomed = false, inCheckout = false;
const bag = []; // { variant, size, qty }
let orders = []; // recent purchases, newest first; remembered in this browser only
try { orders = JSON.parse(localStorage.getItem('leisure-orders')) || []; } catch { /* storage unavailable */ }

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
}

// ---------- item pop-up ----------
function showModel() {
  spinPivot.clear();
  spinPivot.add(preview(cur.variant));
  spinPivot.rotation.y = -.5;
  spinPivot.scale.setScalar(.01); // pops in
}
function renderPanel() {
  const p = cur.variant.product, chart = CHARTS[p.chart || 'top'];
  $('pBrand').textContent = p.brand;
  $('pName').textContent = p.name;
  $('pPrice').textContent = '$' + p.price;
  $('pColors').hidden = p.variants.length < 2;
  $('pColors').innerHTML = '<span>COLOR</span>' + p.variants.map((v, i) =>
    `<button class="chip ${v === cur.variant ? 'on' : ''}" data-v="${i}"><i class="sw" style="background:${v.sleeve || v.fabric}"></i>${v.color}</button>`).join('');
  $('pSizes').innerHTML = '<span>SIZE</span>' + Object.keys(chart.rows).map(k =>
    `<button class="chip ${k === cur.size ? 'on' : ''}" data-s="${k}">${k}</button>`).join('');
  $('sizeHead').innerHTML = ['Size', ...chart.cols].map(c => `<th>${c}</th>`).join('');
  $('sizeRows').innerHTML = Object.entries(chart.rows).map(([k, [a, b]]) =>
    `<tr class="${k === cur.size ? 'me' : ''}"><td>${k}</td><td>${a}</td><td>${b}</td></tr>`).join('');
}
function openPanel(item) {
  if (active === item) return;
  active = item;
  cur = { variant: item.variant, size: Object.keys(CHARTS[item.variant.product.chart || 'top'].rows)[1] };
  renderPanel();
  showModel();
  sizes.classList.remove('open');
  panel.classList.add('open');
  fitSpin();
}
function closePanel() {
  setZoom(false);
  active = cur = null;
  panel.classList.remove('open');
}
$('pColors').onclick = e => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  cur.variant = cur.variant.product.variants[b.dataset.v];
  renderPanel(); showModel();
};
$('pSizes').onclick = e => {
  const b = e.target.closest('[data-s]');
  if (b) { cur.size = b.dataset.s; renderPanel(); }
};
$('close').onclick = closePanel;
$('sizing').onclick = () => sizes.classList.toggle('open');
$('buy').onclick = () => {
  if (!cur) return;
  const line = bag.find(l => l.variant === cur.variant && l.size === cur.size);
  if (line) line.qty++; else bag.push({ variant: cur.variant, size: cur.size, qty: 1 });
  renderBag();
  $('bag').classList.remove('bump'); void $('bag').offsetWidth; $('bag').classList.add('bump');
  toast(`${cur.variant.product.name} (${cur.variant.color}, ${cur.size}) added to bag`);
  closePanel();
};

// enlarge: the same canvas moves into a centred overlay; drag spins, click toggles
function setZoom(on) {
  if (zoomed === on) return;
  zoomed = on;
  $(on ? 'zoombox' : 'spinbox').appendChild(spinCanvas);
  $('zoom').classList.toggle('on', on);
  fitSpin();
}
let drag = null;
spinCanvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, moved: 0 }; spinCanvas.setPointerCapture(e.pointerId); });
spinCanvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  drag.x = e.clientX; drag.moved += Math.abs(dx);
  spinPivot.rotation.y += dx * .012;
});
spinCanvas.addEventListener('pointerup', () => {
  const click = drag && drag.moved < 5;
  drag = null;
  if (click) setZoom(!zoomed);
});
spinCanvas.addEventListener('pointercancel', () => { drag = null; });
$('zoom').addEventListener('click', e => { if (e.target !== spinCanvas) setZoom(false); });

// ---------- bag, checkout, recent purchases ----------
// The bag's pieces float over the counter while checking out.
const stage = new THREE.Group();
stage.position.set(COUNTER.x - .2, 2.2, COUNTER.z + .2);
stage.scale.setScalar(.001);
scene.add(stage);

const bagTotal = () => bag.reduce((s, l) => s + l.qty * l.variant.product.price, 0);
function renderBag() {
  const count = bag.reduce((s, l) => s + l.qty, 0), sub = bagTotal();
  $('bagCount').textContent = count;
  $('coList').innerHTML = bag.length ? bag.map((l, i) => `<li>
      <div><i class="sw" style="background:${l.variant.sleeve || l.variant.fabric}"></i>${l.variant.product.name}<small>${l.variant.color} / ${l.size} / $${l.variant.product.price}</small></div>
      <div class="qty"><button data-i="${i}" data-d="-1" aria-label="Remove one">-</button>${l.qty}<button data-i="${i}" data-d="1" aria-label="Add one">+</button></div>
    </li>`).join('') : '<li class="empty">YOUR BAG IS EMPTY</li>';
  $('coSub').textContent = '$' + sub;
  $('coShip').textContent = count ? '$' + SHIPPING : '-';
  $('coTotal').textContent = '$' + (count ? sub + SHIPPING : 0);
  // ponytail: rebuilds the display models on every change; pool them if bags get big
  stage.clear();
  bag.slice(0, 4).forEach((l, i, a) => {
    const s = makeGarment(l.variant);
    s.scale.setScalar(.45);
    s.position.x = (i - (a.length - 1) / 2) * .85;
    stage.add(s);
  });
}
function renderOrders() {
  $('orders').innerHTML = orders.length ? orders.map(o => `<li>
      <div class="ohead"><b>#${esc(o.id)}</b><span>${esc(o.when)}</span><b>$${esc(o.total)}</b></div>
      <small>${o.lines.map(l => `${esc(l.qty)}x ${esc(l.name)} (${esc(l.color)}, ${esc(l.size)})`).join('<br>')}</small>
    </li>`).join('') : '<li class="empty">NO PURCHASES YET</li>';
}
$('coList').onclick = e => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  const line = bag[b.dataset.i];
  line.qty += +b.dataset.d;
  if (line.qty < 1) bag.splice(b.dataset.i, 1);
  renderBag();
};
function setCheckout(on) {
  if (on) closePanel();
  inCheckout = on;
  document.body.classList.toggle('co', on);
  checkout.classList.toggle('open', on);
  $('coBody').hidden = false; $('coDone').hidden = true;
  if (on) checkout.scrollTop = 0;
  if (on) target = { x: TILL_X, z: -2.4 }; // the penguin walks up to the till
}
$('bag').onclick = () => setCheckout(!inCheckout);
$('ordersBtn').onclick = () => { setCheckout(true); $('ordersTitle').scrollIntoView({ behavior: 'smooth' }); };
$('coClose').onclick = $('coBack').onclick = () => setCheckout(false);
// Demo checkout: nothing is sent anywhere and no payment is taken. It logs the order under
// "recent purchases" (kept in this browser), empties the bag and confirms on screen.
$('coForm').onsubmit = e => {
  e.preventDefault();
  if (!bag.length) return toast('Your bag is empty');
  const id = (orders[0]?.id || 1000) + 1;
  orders.unshift({
    id, total: bagTotal() + SHIPPING,
    when: new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
    lines: bag.map(l => ({ qty: l.qty, name: l.variant.product.name, color: l.variant.color, size: l.size })),
  });
  orders.length = Math.min(orders.length, 5);
  try { localStorage.setItem('leisure-orders', JSON.stringify(orders)); } catch { /* still shown this session */ }
  bag.length = 0;
  renderBag(); renderOrders();
  $('coOrder').textContent = 'ORDER #' + id;
  $('coBody').hidden = true; $('coDone').hidden = false;
  toast('Purchase has been sent!');
};
renderBag(); renderOrders();

// ---------- input ----------
const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let pointerOn = false, target = null;
const keys = {};
const setNdc = e => { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerOn = true; };

function pick() {
  const hit = ray.intersectObjects(pickable, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (!o.userData.item) o = o.parent;
  return o.userData.item;
}
canvas.addEventListener('pointermove', e => {
  setNdc(e);
  tag.style.transform = `translate(${e.clientX + 16}px,${e.clientY + 18}px)`;
});
canvas.addEventListener('pointerleave', () => { pointerOn = false; });
canvas.addEventListener('pointerdown', e => {
  if (inCheckout) return;
  setNdc(e);
  ray.setFromCamera(ndc, camera);
  const item = pick();
  if (item) return openPanel(item);   // the pop-up only opens on click
  closePanel();
  if (ray.intersectObject(posterMesh).length) return setPoster(true);
  const p = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
  if (p) target = constrain(p);
});
// poster: the full-resolution image pops up in the middle of the screen
const posterView = $('posterView');
const setPoster = on => posterView.classList.toggle('on', on);
posterView.onclick = () => setPoster(false);
addEventListener('keydown', e => {
  if (e.key === 'Escape' && posterView.classList.contains('on')) return setPoster(false);
  if (e.key === 'Escape') return zoomed ? setZoom(false) : inCheckout ? setCheckout(false) : closePanel();
  if (e.target.tagName !== 'INPUT') keys[e.key.toLowerCase()] = true;
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function setHover(item) {
  hovered = item;
  canvas.style.cursor = item ? 'pointer' : '';
  tag.classList.toggle('on', !!item);
  if (item) tag.textContent = `${item.variant.product.brand} - $${item.variant.product.price}`;
}

// ---------- camera: fixed spot, dolly-in intro, light parallax, glide to the till for checkout ----------
const LOOK = new THREE.Vector3(0, 1, 0), OFF = new THREE.Vector3(0, 8.2, 14.5);
const CO_POS = new THREE.Vector3(2.0, 3.8, 3.6), CO_LOOK = new THREE.Vector3(2.6, 1.6, -4);
let fit = 1, shift = 0, co = 0, introStart = -1;
const par = new THREE.Vector2();

function resize() {
  const h = Math.min(innerHeight, 480); // low internal resolution, upscaled with nearest-neighbour
  renderer.setSize(Math.round(h * innerWidth / innerHeight), h, false);
  camera.aspect = innerWidth / innerHeight;
  fit = Math.max(1, 1.5 / camera.aspect); // pull back on narrow screens so the room still fits
  camera.updateProjectionMatrix();
  fitSpin();
}
addEventListener('resize', resize);
resize();

// ---------- loop ----------
const clock = new THREE.Clock(), v = new THREE.Vector3(), v2 = new THREE.Vector3();
let walk = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime, k = 1 - Math.exp(-dt * 10);

  // hover: glowing green outline + lift
  let hit = null;
  if (pointerOn && !inCheckout) { ray.setFromCamera(ndc, camera); hit = pick(); }
  if (hit !== hovered) setHover(hit);
  // the poster is clickable too: pointer cursor only, no outline
  canvas.style.cursor = hit || (pointerOn && !inCheckout && ray.intersectObject(posterMesh).length) ? 'pointer' : '';
  hullGlow.opacity = .3 + Math.sin(t * 6) * .14;

  for (const it of items) {
    const g = it.group, lit = it === hovered, on = lit || it === active;
    if (lit !== it.lit) { it.lit = lit; g.userData.hull.forEach(o => { o.visible = lit; }); }
    it.h += ((on ? 1 : 0) - it.h) * k;
    g.scale.setScalar(SHIRT * (1 + it.h * .15));
    g.position.z = it.h * .3;
    g.rotation.z = Math.sin(t * 1.3 + it.phase) * .03 + Math.sin(t * 7) * .05 * it.h;
    g.rotation.x = -it.h * .1;
  }

  // penguin
  let vx = 0, vz = 0;
  if (!inCheckout) {
    vx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    vz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  }
  if (vx || vz) target = null;
  else if (target) {
    vx = target.x - peng.position.x; vz = target.z - peng.position.z;
    if (Math.hypot(vx, vz) < .1) { target = null; vx = vz = 0; }
  }
  const len = Math.hypot(vx, vz);
  let face = null;
  if (len) {
    peng.position.x += vx / len * 3 * dt; peng.position.z += vz / len * 3 * dt;
    constrain(peng.position);
    face = Math.atan2(vx, vz);
  } else if (inCheckout) face = Math.PI; // turn to the cashier
  if (face !== null) {
    const d = face - peng.rotation.y;
    peng.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * k;
  }
  // cashier idles and keeps an eye on the penguin
  cashier.position.y = Math.sin(t * 1.6) * .012;
  const look = clamp(Math.atan2(peng.position.x - cashier.position.x, peng.position.z - cashier.position.z), -.9, .9);
  cashierHead.rotation.y += (look - cashierHead.rotation.y) * k * .3;
  walk += ((len ? 1 : 0) - walk) * k;
  const w = Math.sin(t * 12) * walk;
  body.rotation.z = w * .14;
  body.position.y = Math.abs(w) * .06 + Math.sin(t * 2) * .015;
  wings.forEach((p, i) => { p.rotation.z = (i ? 1 : -1) * (Math.abs(w) * .5 + Math.sin(t * 2) * .04); });
  feet[0].position.z = footZ + w * .16; feet[1].position.z = footZ - w * .16;

  // camera
  if (introStart >= 0) {
    const e = 1 - Math.pow(1 - clamp((t - introStart) / 3, 0, 1), 3);
    par.x += (ndc.x * .6 - par.x) * k * .25; par.y += (ndc.y * .3 - par.y) * k * .25;
    shift += ((active && innerWidth > 640 ? 1.5 : 0) - shift) * k * .35; // make room for the pop-up
    co += ((inCheckout ? 1 : 0) - co) * k * .3;
    const c = co * co * (3 - 2 * co);
    v.copy(OFF).multiplyScalar(fit * (1 + (1 - e) * .9)).add(LOOK);
    v.x += shift + par.x * e;
    v.y += (1 - e) * 4 + par.y * e;
    camera.position.lerpVectors(v, CO_POS, c);
    camera.lookAt(v2.copy(LOOK).setX(shift).lerp(CO_LOOK, c));

    stage.scale.setScalar(Math.max(.001, c));
    stage.children.forEach((s, i) => { s.rotation.y = t * 1.2 + i; s.position.y = Math.sin(t * 2 + i) * .06; });
    renderer.render(scene, camera);
  }

  if (cur) {
    if (!drag) spinPivot.rotation.y += dt * 1.1;
    spinPivot.scale.lerp(v.setScalar(1), k * .6);
    spinR.render(spinScene, spinCam);
  }
});

// reveal
introStart = clock.getElapsedTime();
$('intro').classList.add('done');
