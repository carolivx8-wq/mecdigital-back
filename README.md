# MecDigital Back

API Express/TypeScript para Vercel Functions. É a autoridade de protocolos, projeção do DTO público, autorização, status dos registros e bloqueio de downloads.

## Local

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

## Verificação

```powershell
npm test
npm run typecheck
npm run build
npm audit
```

`SUPABASE_SERVICE_ROLE_KEY` e `PROTOCOL_PEPPER` são secrets exclusivos do backend.
