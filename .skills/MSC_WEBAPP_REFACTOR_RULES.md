\# MSC\_WEBAPP\_REFACTOR\_RULES



\## Goal



Refactor existing MuaSamCong web app without breaking working features.



\## Non-negotiable



\- Do not rebuild from scratch.

\- Do not redesign analytics.

\- Do not simplify old functions.

\- Do not call data Workers directly from browser.

\- Frontend must call only `/api/...`.

\- Gateway Worker is the security boundary.

\- Existing data Workers should stay unchanged unless absolutely required.



\## Target repo structure



```txt

msc-webapp/

&#x20; index.html

&#x20; manifest.json

&#x20; sw.js

&#x20; src/

&#x20;   app.js

&#x20;   api.js

&#x20;   auth.js

&#x20;   admin.js

&#x20;   audit.js

&#x20;   notifications.js

&#x20;   styles.css

&#x20; legacy/

&#x20;   tracuuvattu.html

&#x20;   tracuugoithau.html

&#x20;   thermal\_analysis.html

&#x20; worker/

&#x20;   gateway.js

&#x20;   wrangler.toml

&#x20;   migrations/

&#x20; docs/

&#x20;   ARCHITECTURE.md

&#x20;   API.md

&#x20;   SECURITY.md

&#x20;   ADMIN.md

&#x20; .skills/

&#x20;   01\_architecture.md

&#x20;   02\_performance.md

&#x20;   03\_security.md

&#x20;   04\_han\_preferences.md

&#x20;   05\_working\_style.d

