const fs = require('fs');
const html = fs.readFileSync('temp_origami_sim/index.html', 'utf8');
const regex = /<script\s+id="([^"]+)"\s+type="x-shader\/x-[^"]+">([\s\S]*?)<\/script>/g;
let match;
let output = 'export const Shaders = {\n';
while ((match = regex.exec(html)) !== null) {
  const id = match[1];
  const content = match[2];
  output += '  "' + id + '": `' + content + '`,\n';
}
output += '};\n';
fs.writeFileSync('src/lib/origami-solver/shaders.js', output);
console.log('Shaders extracted.');