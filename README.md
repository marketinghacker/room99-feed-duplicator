# Room99 Feed Duplicator

> Dokument napisany **z myślą o AI agentach** (Claude Code, Cursor, ChatGPT) którzy będą rozbudowywać ten projekt. Czytaj uważnie — zawiera pełną historię, kontekst biznesowy, lessons learned i constraints które MUSZĄ być respektowane przy każdej zmianie.

---

## 1. CEL BIZNESOWY — dlaczego ten projekt istnieje

**Klient:** Room99 (room99.pl) — sklep e-commerce z zasłonami, narzutami, poszewkami, ~1841 SKU.

**Agencja:** Marketing Hackers (Marcin Michalski, marcin@marketing-hackers.com).

**Problem klienta:** W Google Shopping Ads (Performance Max + Standard Shopping) Room99 płaci wysokie CPC bo:
1. Tytuły produktów są nieoptymalne SEO-wise (np. "ZASŁONA NA TARAS GARDEN LINE" zamiast "ZASŁONA DO ALTANY")
2. Klienci szukają po różnych keywords ("zasłona do altany", "zasłona ogrodowa", "markiza", "zasłona nieprzemakalna") a feed ma tylko jedną wersję tytułu
3. Bez testów A/B/C tytułów — nie wiadomo która wersja konwertuje najlepiej

**Cel:** A/B/C test wielu wariantów tytułów per produkt w Google Shopping → identyfikacja tytułów z najniższym CPC + najwyższym ROAS → migracja main feed do najlepszych tytułów.

**KPI sukcesu:** Lift ROAS o min. 15% w 6 tygodni, inaczej agencja traci klienta.

**Stake:** Room99 to ważne konto Marketing Hackers. Marcin powiedział wprost: *"Stracę klienta jak nie będę tego robił."*

---

## 2. WSPÓŁPRACA Z FEEDOPTIMISE (https://app.feedoptimise.com)

**Konto FeedOptimise:** Marcin ma platinum-tier konto z dostępem do API:
- Account ID: `1805` (Room99)
- Campaign ID: `3809`
- Feed Google PL: `507fc39b-dc19-4f5d-9107-db1900f6bb21`
- Source Shoper (natywna integracja): `00734136-a6d7-4eac-9628-d889f9a79216`
- Publiczny URL feedu Google PL: `https://io.feedoptimise.com/feed/1805/3809/507fc39b-dc19-4f5d-9107-db1900f6bb21/google-pl.tsv`

**Co FeedOptimise robi:**
- Pobiera produkty z Shoper API co 1h (full sync) — natywny connector
- Transformuje przez modyfikatory (Word Capitalize tytułów, OpenAI Description Creator dla descriptions, Sale price converter, Override z Supplemental Google Sheet dla color/size/material, Currency formatter PLN, Shipping formatter 10 PLN PL)
- Publikuje feed Google TSV przez SFTP do Google Merchant Center: `1805_3809_Google_PL.tsv`

**Co nie udało się w FO (HISTORIA — NIE PRÓBUJ PONOWNIE):**
W sesji 2026-05-13 (6 godzin pracy) próbowaliśmy zrobić duplikację produktów wewnątrz FeedOptimise używając mechanizmu `variant_field` (JSON-Variants). Wszystko zakończyło się fiaskiem mimo pełnego dostępu do REST API FO:

- `PUT /v1/feed/feed.json` z modified `variant_field` zwraca 200 OK
- Ale następne `force_update` zwraca **"Internal Modifier Error"** w runtime — silnik FO odrzuca strukturę modyfikatorów którą buduję
- Próbowaliśmy 3 różne podejścia: 5 sequential operations Operand modifier, single IF z JSON string, IF z type:'list' — wszystkie failują w runtime
- Backup policy 80% threshold ratuje przed wgraniem 0 items
- **Reverse-engineering modifier engine FO bez wewnętrznej dokumentacji jest niemożliwe**
- Source endpoint dla edycji mapping zwraca 403 ACL (brak permissions w Marcina koncie)
- Dodanie 5 nowych feedów w FO byłoby drogie (per-feed-fee × 5 miesięcznie)
- Tworzenie nowego feeda w FO przez API DZIAŁA ale zwiększyło bym miesięczny koszt

**Wniosek z tej sesji:** **Wyszliśmy poza FeedOptimise.** Skrypt zewnętrzny pobiera feed FO bez zmian, modyfikuje go i publikuje jako drugi feed do GMC.

---

## 3. ARCHITEKTURA — jak to działa end-to-end

```
┌──────────────────┐
│  Shoper API      │ ← Room99 store backend
└─────┬────────────┘
      │ co 1h (FO natywny sync)
      ▼
┌──────────────────────────────────┐
│  FeedOptimise                    │
│  - Pobiera, transformuje         │
│  - Publikuje Google TSV          │
└─────┬────────────────────────────┘
      │ public URL (no auth):
      │ io.feedoptimise.com/feed/1805/3809/.../google-pl.tsv
      ▼
┌──────────────────────────────────────────────────────────┐
│  GitHub Actions (cron co 1h + push trigger)              │
│  Repo: marketinghacker/room99-feed-duplicator            │
│  - regenerate-feed.yml: pobiera feed, generuje duplikaty │
│  - handle-new-variant-issue.yml: dodaje regułę z Issue   │
└─────┬────────────────────────────────────────────────────┘
      │ commituje output/ do main
      ▼
┌──────────────────────────────────────────────────────────┐
│  GitHub Pages (serwer publiczny)                         │
│  URL: marketinghacker.github.io/room99-feed-duplicator/  │
│       output/google-pl-with-test-titles.tsv              │
└─────┬────────────────────────────────────────────────────┘
      │ scheduled fetch (Daily lub Hourly)
      ▼
┌──────────────────────────────────┐
│  Google Merchant Center          │
│  Primary feed #1: FeedOptimise   │ ← 1841 oryginałów (z SFTP od FO)
│  Primary feed #2: GitHub Pages   │ ← 360+ duplikatów (od nas)
└─────┬────────────────────────────┘
      │ łączy oba feedy
      ▼
┌──────────────────────────────────┐
│  Google Shopping Ads             │
│  - Performance Max               │
│  - Standard Shopping             │
└──────────────────────────────────┘

ZARZĄDZANIE (Marcin dodaje nowe warianty):
┌────────────────────────────────────────────┐
│  Vercel mini-app (room99-feed-admin)       │
│  URL: room99-feed-admin.vercel.app         │
│  - Formularz HTML (mobile-friendly)        │
│  - Tworzy GitHub Issue z labelem           │
└─────┬──────────────────────────────────────┘
      │ POST /api/add-variant
      ▼
┌────────────────────────────────────────────┐
│  GitHub Issue (label: new-variant)         │
└─────┬──────────────────────────────────────┘
      │ trigger workflow
      ▼
┌────────────────────────────────────────────┐
│  handle-new-variant-issue.yml              │
│  - Parsuje body, dodaje regułę do config   │
│  - Commit do main → regenerate-feed cron   │
└────────────────────────────────────────────┘
```

---

## 4. PLIKI W TYM REPO

### `generate-feed.js` — główny skrypt

Node.js 24, zero zewnętrznych dependencji (tylko built-in `https`, `fs`, `path`).

**Co robi krok po kroku:**

1. **Czyta `config.json`** — reguły duplikacji + URL feedu źródłowego
2. **Pobiera TSV z FeedOptimise** przez HTTPS GET (no auth required, URL publiczny)
3. **Parsuje TSV** — pierwsza linia = headers, kolejne = produkty (tab-separated)
4. **Filtruje out-of-stock** — pomija duplikację jeśli `availability !== 'in stock'`
   - Powód: nie chcemy generować duplikatów dla produktów których nie ma na magazynie (GMC będzie je i tak filtrować, ale lepiej nie wgrywać)
5. **Dla każdej aktywnej reguły z `config.duplicateRules`:**
   - Sprawdza czy `title` produktu zawiera `matchInTitle` (case-insensitive regex)
   - Jeśli tak — generuje duplikat:
     - `id` = `${parent.id}_${rule.dupSuffix}` (np. `9491_t1`)
     - `title` = `parent.title.replace(searchInTitle, replaceWith)` z case-insensitive regex, potem **Word Capitalize** (pierwsza litera każdego słowa wielka, ale rozmiary `155x270` zachowane bez konwersji)
     - `gtin` = `''` (puste — wymaganie audytora — żeby GMC nie odrzucił jako "Duplicate Product")
     - `mpn` = `''`
     - `identifier_exists` = `'no'`
     - `custom_label_0` = `'TITLE_TEST'` (do filtrowania w Google Ads)
     - `custom_label_1` = `rule.customLabel1` (np. `'t1'`) — segmentacja kampanii per wariant
     - Wszystkie inne pola dziedziczone z parent (cena, link, image, availability, custom_label_2/3/4, etc.)
6. **Zapisuje output** do `output/google-pl-with-test-titles.tsv`
   - **TYLKO duplikaty** (NIE oryginały!) — bo oryginały już są w GMC z głównego feeda FO
   - Headers rozszerzone o `identifier_exists` jeśli nie istnieje

**Output filozofia:** Plik output **dodaje** nowe wiersze do GMC (jako drugi primary feed). GMC łączy ten feed z oryginalnym Google PL od FO automatycznie po SKU/ID.

### `config.json` — konfiguracja

Schema:
```json
{
  "feedSourceUrl": "https://io.feedoptimise.com/feed/.../google-pl.tsv",
  "feedOutputFile": "output/google-pl-with-test-titles.tsv",
  "duplicateRules": [
    {
      "id": "unique-rule-id",           // do trackingu (np. 'issue-3-t7')
      "matchInTitle": "GARDEN LINE",    // filter — duplikuj tylko produkty których title zawiera ten string
      "searchInTitle": "ZASŁONA NA TARAS", // co usunąć z tytułu (case-insensitive)
      "replaceWith": "ZASŁONA DO ALTANY", // co wstawić w to miejsce
      "dupSuffix": "t1",                // dodawane do id (9491 → 9491_t1)
      "customLabel1": "t1",             // wartość custom_label_1 dla tego wariantu
      "active": true,                   // false = wyłącz tę regułę
      "notes": "Test #1 — gazebo keyword"
    }
  ],
  "duplicateFieldOverrides": {
    "gtin": "",
    "mpn": "",
    "identifier_exists": "no",
    "custom_label_0": "TITLE_TEST"
  }
}
```

**Pułapka konfiguracyjna (lesson learned):**
- `matchInTitle` = **filter** (kto kwalifikuje się do duplikacji). Przykład: `GARDEN LINE` filtruje wszystkie zasłony ogrodowe.
- `searchInTitle` = **co usunąć z tytułu**. Przykład: `ZASŁONA NA TARAS` — ten fragment **zniknie** z duplikatu.
- `replaceWith` = **co wstawić w to miejsce**.

Jeśli `searchInTitle = matchInTitle = "GARDEN LINE"`, to skrypt usunie "GARDEN LINE" ale zostawi "ZASŁONA NA TARAS" — efekt: duplikat ma duplikujący się tekst (`"Zasłona Na Taras Zasłona Wodoodporna - ..."`).

**Poprawne:** zazwyczaj `searchInTitle` to konkretny fragment do podmiany (`ZASŁONA NA TARAS`), a `matchInTitle` to szerszy filtr grupy (`GARDEN LINE`).

### `package.json`

Specifies Node.js engine ≥ 18. Zero npm dependencies.

### `.github/workflows/regenerate-feed.yml`

GitHub Actions cron:
- `cron: '0 * * * *'` — co 1h
- `workflow_dispatch` — manual trigger
- `push` na `config.json` lub `generate-feed.js` — natychmiast po commit

Kroki:
1. Checkout repo
2. Setup Node 24
3. Run `node generate-feed.js`
4. Git commit output/ jeśli się zmienił
5. Push do main

**Permissions:** `contents: write` (do commitu wygenerowanego pliku).

### `.github/workflows/handle-new-variant-issue.yml`

Action triggerowany na `issues.opened` z labelem `new-variant`.

Kroki:
1. Czyta `github.event.issue.body`
2. Parsuje pola Issue Form (regex `### {label}\n\n{value}`) — pola: `Grupa produktow`, `Szukaj w tytule`, `Zastap przez`, `Sufiks ID`, `Notatka`
3. Sprawdza czy dupSuffix już istnieje (jeśli tak — error)
4. Dodaje nową regułę do `config.duplicateRules`
5. Commit `config.json` (trigger regenerate-feed)
6. Komentuje issue + zamyka

**Permissions:** `contents: write`, `issues: write`

### `.github/ISSUE_TEMPLATE/dodaj-wariant.yml`

GitHub Issue Forms template z 4 polami (matchInTitle, searchInTitle, replaceWith, dupSuffix) + opcjonalne notes.

**Uwaga:** Labels w template **MUSZĄ** być identyczne ze stringami w regex parser w `handle-new-variant-issue.yml` i body builder w `feed-duplicator-admin/api/add-variant.js`. Wszystkie 3 sync. Bez emoji (emoji powodują problemy z regex parsingiem).

---

## 5. INTEGRACJA Z VERCEL MINI-APP (`room99-feed-admin`)

**Drugi repo:** `marketinghacker/room99-feed-admin` deployed na Vercel.

**Co robi:** Formularz HTML + serverless function która tworzy GitHub Issue w tym repo (`room99-feed-duplicator`). Issue uruchamia `handle-new-variant-issue.yml` workflow → dodaje regułę → regeneruje feed.

**Vercel env vars wymagane:**
- `GITHUB_TOKEN` — fine-grained PAT z permissionem `Issues: Read and write` na repo `room99-feed-duplicator`
- `GITHUB_OWNER` — `marketinghacker`
- `GITHUB_REPO` — `room99-feed-duplicator`

Patrz `feed-duplicator-admin/README.md` po szczegóły.

---

## 6. LESSONS LEARNED — NIE POWTARZAJ TYCH BŁĘDÓW

### a) Nie próbuj `variant_field` w FeedOptimise
Skomplikowany, runtime nie działa, source endpoint 403. **Backup policy** chronił feed przed zniszczeniem (wymagany min 80% items). **Zachowaj `split_variants: 1` w feed config** — to jedyna zmiana w FO która została trwała i jest poprawna.

### b) Nie pakuj `.github/` do zip dla Marcina
macOS Finder ukrywa foldery z kropką → Marcin myli się że pliki są puste. Rozwiązanie: **flat structure** ze ścieżką w nazwie pliku (`GITHUB-PATH_dotGITHUB-SLASH-workflows-SLASH-...`).

### c) Emoji w GitHub Issue Form labels łamią regex parser
Niektóre emoji (`🎯` U+1F3AF, `🏷️` U+1F3F7+VS) parser regex pomija. Inne (`🔍` U+1F50D, `✏️` U+270F+VS) działają. **Nie używaj emoji w labelach formularza.** Tekstowe nazwy (`Grupa produktow`, `Sufiks ID`) działają deterministycznie.

### d) Bash + pipe + python crash zostawia pusty plik
Wcześniejszy commit (`f2f59159`) przypadkowo nadpisał `config.json` pustym plikiem. **Zawsze** używaj `python3 << PYEOF` (heredoc) zamiast pipowania, i sprawdzaj plik output (`wc -c`) przed PUT do GitHub.

### e) Vercel free deployment redirect na `/api/`
Vercel serverless functions w `api/` folderze są dostępne automatycznie jako `/api/{filename}`. **Nie używaj** `next.js`/`express` — overkill. Plain `export default function handler(req, res)` w pliku `.js` wystarczy.

### f) GitHub deprecated Node 20 (2026-06-02)
Aktualizuj akcje GitHub do najnowszych wersji periodycznie:
- `actions/checkout@v5`
- `actions/setup-node@v6` z `node-version: '24'`
- `actions/github-script@v8`

### g) `Word Capitalize` musi pomijać litery między cyframi
Pierwotna regex `(\p{L})(\p{L}*)/gu` capitalizuje `x` w `155x270` → `155X270`. Naprawione: `(?<![\p{L}\d])(\p{L})(\p{L}*)` — używa negative lookbehind.

### h) Out-of-stock filter MUSI być na poziomie generation
GMC filtruje out-of-stock ale lepiej nie wgrywać. Sprawdź `row.availability.toLowerCase() === 'in stock'` przed duplikacją.

### i) GTIN/MPN pust + identifier_exists=no — wymagane
Audytor wskazał: bez tego GMC odrzuci duplikaty jako "Duplicate product" (ten sam GTIN co parent w drugim feedzie). `duplicateFieldOverrides` w config.

### j) **NIE TWÓRZ wiele feedów FO** — billing per feed
Marcin zapłaci ekstra za każdy. **Zewnętrzny skrypt + GitHub Pages = darmowy.**

---

## 7. JAK ROZBUDOWYWAĆ TEN PROJEKT

Marcin używa Claude Code lub innych AI agentów do rozszerzania funkcjonalności. **Najprawdopodobniejsze przyszłe wymagania:**

1. **Multiple parent feeds support** — Room99 może mieć inne feedy (Bing, Meta) — dodać `multipleFeedSources` w config
2. **Dashboard performance** — endpoint który pokazuje statystyki per `custom_label_1` z Google Ads API (CTR, CPC, ROAS per wariant)
3. **Auto-deactivation** — jeśli wariant ma niski CTR przez 14 dni → `active: false` automatycznie
4. **AI-generated keywords** — OpenAI/Claude generuje propozycje keywords na bazie konkurencji (Ahrefs MCP)
5. **A/B significance testing** — chi-square test czy różnica między t1 a t2 jest statystycznie istotna
6. **Bulk actions** — `active: false` dla wszystkich reguł z prefiksem `t*` (np. wyłączenie eksperymentu)
7. **Versioning duplikatów** — historia zmian w `t1` przez `git log config.json`
8. **Slack/email notifications** — po regeneracji feed
9. **Preview duplikatów przed commit** — w admin app pokazać sample 3 produktów które dostaną dany variant ZANIM zatwierdzimy regułę

---

## 8. SETUP OD ZERA (gdyby trzeba było odtworzyć projekt)

### Wymagania:
- Konto GitHub
- Konto Vercel (free)
- Dostęp do FeedOptimise (publiczny feed URL)
- Dostęp do Google Merchant Center

### Kroki:

1. Stwórz repo `room99-feed-duplicator` na GitHub (Public — wymagane dla GitHub Pages free)
2. Wgraj pliki:
   - `README.md` (ten plik)
   - `generate-feed.js`
   - `config.json`
   - `package.json`
   - `.github/workflows/regenerate-feed.yml`
   - `.github/workflows/handle-new-variant-issue.yml`
   - `.github/ISSUE_TEMPLATE/dodaj-wariant.yml`
3. Settings → Pages → Source: Deploy from branch `main` / `(root)` → Save
4. Actions tab → Run `Regenerate Feed (cron)` workflow manualnie
5. Sprawdź output: `https://<USER>.github.io/room99-feed-duplicator/output/google-pl-with-test-titles.tsv`
6. Wklej w GMC → Products → Feeds → Add primary feed → Scheduled fetch → URL

Po tym admin app deploy z `feed-duplicator-admin/`.

---

## 9. KONTAKTY

- **Marcin Michalski** (klient agencji, project owner) — marcin@marketing-hackers.com
- **FeedOptimise support** — support@feedoptimise.com (jeśli problemy z feedem źródłowym)
- **Google Merchant Center** — Diagnostics tab po fetch'u

---

## 10. AKTUALNY STAN (2026-05-13)

- ✅ Repo z working skryptem
- ✅ 7 aktywnych reguł duplikacji (5 GARDEN LINE + 1 Blackout + 1 wodoodporna)
- ✅ Cron co 1h regeneruje feed
- ✅ GitHub Pages hostuje output publicznie
- ✅ Vercel admin app pozwala dodawać warianty bez edycji plików
- ✅ Custom_labels dziedziczone z parent (zmiana w FO → duplikaty też dostają)
- ✅ Out-of-stock auto-filtrowane
- ⏳ Marcin podłącza output URL do GMC (manual setup once)
- ⏳ Po 14-30 dniach: dane z Google Ads pokażą zwycięskie warianty

---

*Ten plik napisany 2026-05-13 przez Claude (Anthropic Sonnet) w cowork mode z Marcinem. Jeśli edytujesz — zachowaj sekcje "Lessons Learned" i "Co nie powtarzaj" niezależnie od refactoringu.*
