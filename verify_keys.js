import dotenv from 'dotenv';

dotenv.config();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

console.log('--- DIAGNÓSTICO DE CHAVES SUPABASE ---');
console.log('1. URL do Projeto (que está online):');
if (!url || !key) {
    console.log('❌ Variáveis ausentes no .env. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
    process.exit(1);
}

const projectRefFromUrl = String(url).replace(/^https?:\/\//, '').split('.')[0];

console.log('   ' + url);
console.log('   ID extraído da URL: ' + projectRefFromUrl);
console.log('');

try {
    const payload = JSON.parse(atob(key.split('.')[1]));
    console.log('2. Chave API (decodificada):');
    console.log('   ID dentro da chave (ref): ' + payload.ref);

    console.log('');
    console.log('--- CONCLUSÃO ---');
    if (projectRefFromUrl === payload.ref) {
        console.log('✅ SUCESSO: A chave pertence a este projeto!');
    } else {
        console.log('❌ ERRO CRÍTICO: Mismatch encontrado!');
        console.log(`   O site está em: ...${url.substring(8, 20)}...`);
        console.log(`   A chave abre:   ...${payload.ref.substring(0, 12)}...`);
        console.log('');
        console.log('   A chave é de OUTRO projeto. Ela não vai funcionar aqui.');
    }
} catch (e) {
    console.log('Erro ao decodificar chave: ' + e.message);
}
