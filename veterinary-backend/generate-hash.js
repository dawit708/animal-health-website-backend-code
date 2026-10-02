const bcrypt = require('bcryptjs');

const password = 'pass123';

// Generate hash
const hash = bcrypt.hashSync(password, 10);

console.log('Password:', password);
console.log('Hash:', hash);
console.log('Length:', hash.length);

// Verify
const isMatch = bcrypt.compareSync(password, hash);
console.log('Verify:', isMatch);