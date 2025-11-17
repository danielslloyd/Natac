// Test corner coordinates

const HEX_SIZE = 50;

function axialToPixel(q, r) {
  const x = HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
  const y = HEX_SIZE * (3/2 * r);
  return [x, y];
}

function hexCorners(center) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    corners.push([
      center[0] + HEX_SIZE * Math.cos(angle),
      center[1] + HEX_SIZE * Math.sin(angle)
    ]);
  }
  return corners;
}

// Test two adjacent hexes
const hex1 = { q: 0, r: 0 };  // Center
const hex2 = { q: 1, r: 0 };  // Right neighbor

const center1 = axialToPixel(hex1.q, hex1.r);
const center2 = axialToPixel(hex2.q, hex2.r);

console.log('Hex 1 center:', center1);
console.log('Hex 2 center:', center2);

const corners1 = hexCorners(center1);
const corners2 = hexCorners(center2);

console.log('\nHex 1 corners:');
corners1.forEach((c, i) => console.log(`  ${i}: [${c[0].toFixed(3)}, ${c[1].toFixed(3)}]`));

console.log('\nHex 2 corners:');
corners2.forEach((c, i) => console.log(`  ${i}: [${c[0].toFixed(3)}, ${c[1].toFixed(3)}]`));

console.log('\nLooking for shared corners:');
corners1.forEach((c1, i1) => {
  corners2.forEach((c2, i2) => {
    const dist = Math.sqrt((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2);
    if (dist < 0.01) {
      console.log(`  Hex1[${i1}] matches Hex2[${i2}]: [${c1[0].toFixed(3)}, ${c1[1].toFixed(3)}]`);
    }
  });
});
