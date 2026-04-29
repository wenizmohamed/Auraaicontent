import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const p = new PrismaClient();
const h = await bcrypt.hash('verify12345', 10);
await p.user.upsert({where:{email:'aura-verify@radix.local'},update:{passwordHash:h},create:{email:'aura-verify@radix.local',passwordHash:h,name:'V'}});
console.log('OK');
await p.\();
