# MemoTrip session a refresh tokeny – fáze 2A

## Schválená pravidla a kompatibilita

- Heslový login a signup nadále vydávají access JWT na 604800 sekund (7 dní).
- Google login nadále vydává access JWT na 900 sekund (15 minut).
- Všechny tři operace nově vracejí neprůhledný refresh token a založí session.
- Session má absolutní platnost 30 dní od loginu/signup. Refresh tuto hranici neposouvá.
- Při refreshi těsně před koncem session je access JWT zkrácen na zbývající celé sekundy.
- Existující HTTP status loginu/signup/Google zůstává 201. `accessToken` je zachován.
- Nová pole jsou aditivní. Android musí neznámá pole ignorovat; refresh token je pouze
  řetězec, nesmí jej dekódovat jako JWT. Zdrojový kód Android klienta není součástí
  tohoto repozitáře; jeho deserializaci nelze lokálně potvrdit.
- BE sám nezajistí automatický refresh v současném Android klientu. Dokud jej FE
  neimplementuje, Google login po expiraci dál vyžaduje přihlášení jako dosud.
- DummyPay request/response kontrakty, vlastnictví nákupů, URL token a hodnoty providerů
  včetně GOOGLE_PLAY se nemění. Implementace Google Play ověřování není v tomto projektu.

### Přechod starých JWT

Stejný JWT_SECRET zůstává zachován; nové tokeny jsou výslovně typu access.
Staré profily se přijímají jen s platným HS256 podpisem, UUID `sub`, celočíselným
`iat` a `exp`, bez neočekávaných claimů a bez budoucího `iat` přes 30 sekund:

- starý heslový access token: má neprázdný `email`, `exp - iat` nejvýše 7 dní;
- starý Google access token: bez `email`, `exp - iat` nejvýše 15 minut;
- starý 30denní Google refresh JWT: jako Bearer vždy odmítnut; na `/auth/refresh`
  rovněž odmítnut. Žádná konverze na novou session.

Po odstranění poslední staré BE instance přirozeně doběhnou všechny staré access
JWT nejpozději do 7 dní. Bezsessionové legacy JWT nelze jednotlivě odvolat logoutem
nebo změnou hesla. Jde o výslovně schválenou dočasnou vlastnost přechodu, nikoliv
zachování záměny refresh/access. Smazaný uživatel je odmítnut i s legacy JWT.

Návrat ke starému BE znovu otevře záměnu starého Google refresh JWT za Bearer
access token a přestane respektovat revokaci nových session. Takový rollback
není bezpečný. Opravu provádět dopředným nasazením, případně zastavením provozu.

## API pro Android

Pouze HTTPS. Tokeny nepatří do URL, analytiky, crash reportů ani logů.
Není potřeba nový klientský secret nebo nová konfigurace JWT klíče.

`POST /auth/login`, `POST /auth/signup`, `POST /auth/google` zachovávají svoje
vstupní tělo a status 201. Úspěšná odpověď všech tří a refresh operace:

```json
{
  "accessToken": "<MemoTrip access JWT>",
  "refreshToken": "<43 znaků base64url, náhodných 32 bajtů>",
  "tokenType": "Bearer",
  "expiresIn": 604800,
  "refreshTokenExpiresAt": "<UTC ISO 8601>",
  "sessionId": "<UUID>",
  "userId": "<UUID>"
}
```

Pro Google je `expiresIn` 900. FE má používat skutečnou hodnotu odpovědi, ne
konstantu. Refresh zachovává sedmidenní access TTL heslové session, s výše uvedeným
omezením koncem session. `Cache-Control: no-store` chrání úspěšné tokenové odpovědi.

### POST /auth/refresh

Bez Bearer hlavičky; platný access token není předpokladem. JSON request:

```json
{ "refreshToken": "<aktuální MemoTrip refresh token>" }
```

200: nová dvojice ve výše uvedeném tvaru. `sessionId`, `userId` a absolutní
`refreshTokenExpiresAt` zůstávají stejné. Starý refresh token se atomicky spotřebuje.
Klient nemůže zvolit jiného uživatele ani délku access tokenu.

### POST /auth/logout

Stejné tělo, bez nutnosti platného access JWT. 204 bez těla. Odvolá příslušnou
session a tím všechny její access JWT i refresh tokeny. Je idempotentní: opakovaný,
neznámý nebo neplatný neprázdný token dostane 204. Známý spotřebovaný token stále
umožní odhlásit svoji session. Ostatní zařízení/session zůstávají aktivní.

### Chybový kontrakt

Refresh/logout mají pro úspěch i zpracované chyby `Cache-Control: no-store`.

```json
{
  "statusCode": 401,
  "code": "REFRESH_TOKEN_INVALID",
  "message": "Authentication request could not be completed."
}
```

FE rozhoduje podle `statusCode` a `code`, ne podle textu `message`.

| Situace | HTTP | code | Reakce Androidu |
|---|---|---|---|
| Access JWT expiroval | 401 | ACCESS_TOKEN_EXPIRED | Nejvýše jeden koordinovaný refresh. |
| Access chybí, má špatný podpis/typ/claims, nebo uživatel neexistuje | 401 | ACCESS_TOKEN_INVALID | Bez automatické smyčky, nové přihlášení. |
| Session neexistuje/je odvolána | 401 | SESSION_REVOKED | Ukončit lokální session. |
| Session expirovala | 401 | SESSION_EXPIRED | Nové přihlášení. |
| Refresh není známý, je expirovaný/odvolaný, legacy JWT nebo access JWT | 401 | REFRESH_TOKEN_INVALID | Smazat tokeny dané session, nové přihlášení. |
| Spotřebovaný refresh se použil znovu | 401 | REFRESH_TOKEN_REUSED | Celá tato session je odvolána; nové přihlášení. |
| Chybí refreshToken, není string, je prázdný nebo delší než 4096 znaků | 400 | VALIDATION_ERROR | Neopakovat. |
| Limit refresh/logout překročen | 429 | RATE_LIMITED | Respektovat Retry-After, žádná smyčka. |
| DB/transakce/vydání tokenu selhalo | 503 | AUTH_TEMPORARILY_UNAVAILABLE | Bez okamžitého odhlášení nebo slepého opakování refresh. |

Nové endpointy mají limit 20 požadavků/minutu/IP každý, vedle stávajícího globálního
rate limiteru. Stávající limiter je v paměti instance, není to globální limit mezi
replikami. Bezpečnost rotace zajišťuje PostgreSQL, nikoliv tento limit.
Dosavadní doménové chyby auth endpointů (např. WRONG_PASSWORD) a jejich statusy se
nemění. Žádná taková 401 nesmí vyvolat refresh jen podle HTTP statusu.

## Android – povinnosti při zapojení automatického refresh

1. Refresh token uložit do úložiště chráněného Android Keystore. Nepoužívat jej jako Bearer.
2. Mít jediný sdílený probíhající refresh pro danou session i při souběhu mnoha requestů.
3. Po ACCESS_TOKEN_EXPIRED čekají ostatní requesty na tentýž refresh. Novou dvojici uložit
   atomicky před uvolněním čekajících requestů. Nezaměnit tokeny mezi účty.
4. Původní request opakovat nejvýše jednou. Druhá 401 obnovování ukončí. Auth endpointy
   z interceptoru automatického refresh vyjmout. Mutace neopakovat bez jistoty, že
   skončily před provedením operace; DummyPay status GET lze bezpečně zopakovat.
5. Přísná replay politika nemá grace window ani idempotency key. Ztracená úspěšná odpověď
   může znamenat nutnost nového loginu. Refresh po timeoutu automaticky neopakovat: první
   pokus mohl token spotřebovat. Stejně obezřetně zacházet s chybou při nejistém commitu.
6. Při logoutu/přepnutí účtu zavolat logout se starým refresh tokenem, zvýšit lokální
   generaci session, zrušit čekající requesty a ignorovat opožděné odpovědi staré session.
   Neodeslaný logout při offline režimu není serverová revokace; tokeny alespoň lokálně smazat.
7. Změna/reset hesla odvolá všechny nové session včetně aktuální, bez náhradní dvojice.
   Po úspěchu vyžádat nové přihlášení. Smazání účtu rovněž odvolá všechny session.

## Uložení, transakce a údržba

`AuthSession` drží vlastníka, profil access TTL, absolutní expiraci a revokaci.
`RefreshToken` drží jen SHA-256 hash náhodného 256bitového tokenu a čas spotřebování.
Žádný refresh token ani jeho hash se nevrací v chybách nebo neloguje. Hash nepotřebuje
password KDF ani sůl: vstup je kryptograficky náhodný, nikoliv uživatelské heslo.

Všechny mutace session, založení po loginu, změna/reset hesla a smazání účtu zamykají
stejný řádek User pomocí parametrizovaného SELECT FOR UPDATE. Po zámku refresh
znovu načte token, aby nepoužil zastaralý předchozí read. Read Committed transakce
pak spotřebuje token a vytvoří pouze hash nástupce. Při replay se nejprve COMMITne
revokace a teprve poté se vrací 401; throw uvnitř transakce by revokaci vrátil zpět.

Dva současné refreshe způsobí jeden úspěch a jeden replay s revokací; i vítězná
odpověď už pak obsahuje odvolané tokeny. Zámek funguje mezi instancemi, včetně
souběhu s logoutem a změnou hesla. Již autorizovaný request běžící před revokací
nelze tímto mechanismem zpětně zrušit.

Historii spotřebovaných tokenů uchovat do absolutního konce session pro detekci
replay. Fáze 2A nemá automatický cleanup job; je potřeba naplánovat údržbu velikosti
tabulek. Expirace funguje i bez mazání. Budoucí cleanup může mazat pouze session
po expiresAt (s retenční rezervou), RefreshToken se smaže kaskádově. Předčasné mazání
historie aktivní session by odstranilo detekci replay.

## Railway a development GO/NO-GO

Nová SQL migrace je aditivní a transakční: přidává pouze dvě tabulky, indexy,
cizí klíče a kontrolní omezení. Nevkládá session pro staré uživatele, nepřepisuje
hesla ani nákupy. Stávající User dostává pouze Prisma vztah bez nového sloupce.

Railway nyní při startu spouští prisma migrate deploy. Nejdříve musí úspěšně projít
migrace a teprve potom se spustit nový BE. Selhání migrace musí zastavit start.
Nový BE nesmí obsluhovat provoz proti nemigrovanému schématu. DDL může krátce
čekat na zámek User kvůli přidání FK; před nasazením ověřit zálohu, oprávnění a
stav migrací development DB. Žádné změny této vzdálené DB nejsou součástí lokální práce.

Během výměny instancí nesmí starý BE dlouhodobě zůstat dostupný, protože stále
akceptuje původní Google refresh JWT jako Bearer a ignoruje session revokace.
Po výměně ověřit healthcheck, login, refresh, replay, logout a DummyPay status.
Nová validace přidává DB čtení session na každý nový JWT request; sledovat latenci,
DB pool a 503. Výpadek DB nepovolí přístup bez kontroly session.

GO pro řízený development test po úspěšných lokálních kontrolách. Není to souhlas
s automatickým pushem/deployem ani GO pro staging/production. Před rozšířením ověřit
Android deserializaci/úložiště a přepínání účtů na reálném klientu. Existující
Google-only chování párování účtů e-mailem není touto fází přepracováno.

## Reprodukovatelné lokální ověření

- npm test -- --runInBand
- npx prisma validate
- npm run build
- Integrační test je explicitně opt-in přes AUTH_TEST_DATABASE_URL. Bez této
  proměnné se přeskočí a nikdy nepoužije DATABASE_URL z .env.
- Test povolí jen localhost/127.0.0.1, port 55439 a DB auth_phase2a. Připravit
  oddělený PostgreSQL cluster bez reálných dat a aplikovat migrace pouze tam.
- Potom nastavit AUTH_TEST_DATABASE_URL na toto lokální připojení a spustit:
  npm run test:e2e -- --runInBand --runTestsByPath test/auth-session.e2e-spec.ts test/rate-limit.e2e-spec.ts test/image-upload.e2e-spec.ts
- Testy Google provider a R2 mockují; nevolají Google, R2, Railway ani platební providery.
