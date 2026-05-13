# Room99 Feed Duplicator

Pobiera feed Google PL z FeedOptimise → dodaje duplikaty z różnymi tytułami → publikuje publicznie. **Nowe warianty dodajesz przez GitHub Issues (klikasz formularz, nie edytujesz plików).**

---

## Setup początkowy — 5 minut, raz w życiu

### Krok 1: Utwórz repo na GitHub
1. https://github.com/new
2. Repository name: `room99-feed-duplicator`
3. Wybierz **Public**
4. **Create repository**

### Krok 2: Wgraj 4 pliki głównego folderu
W repo: **Add file → Upload files** → przeciągnij:
- `README.md`
- `generate-feed.js`
- `config.json`
- `package.json`

→ **Commit changes**

### Krok 3: Stwórz workflow regenerate-feed (1 plik)
1. **Add file → Create new file**
2. Wpisz nazwę: `.github/workflows/regenerate-feed.yml`
3. Otwórz lokalnie plik `WORKFLOW-do-wgrania-recznie/regenerate-feed.yml`, skopiuj **całą zawartość**, wklej
4. **Commit new file**

### Krok 4: Stwórz workflow do obsługi Issues (1 plik)
1. **Add file → Create new file**
2. Wpisz nazwę: `.github/workflows/handle-new-variant-issue.yml`
3. Otwórz lokalnie plik `WORKFLOW-do-wgrania-recznie/handle-new-variant-issue.yml`, skopiuj zawartość, wklej
4. **Commit new file**

### Krok 5: Stwórz Issue template (1 plik)
1. **Add file → Create new file**
2. Wpisz nazwę: `.github/ISSUE_TEMPLATE/dodaj-wariant.yml`
3. Otwórz lokalnie plik `ISSUE-TEMPLATE-do-wgrania-recznie/dodaj-wariant.yml`, skopiuj zawartość, wklej
4. **Commit new file**

### Krok 6: Włącz GitHub Pages
1. **Settings → Pages**
2. Source: **Deploy from a branch** → Branch: **main** / **/ (root)** → **Save**

### Krok 7: Uruchom pierwszy raz
1. **Actions** → **Regenerate Feed (cron)** → **Run workflow** → **Run workflow**
2. Poczekaj 30s na zielony ✓

### Krok 8: Skopiuj URL do GMC
Publiczny URL:
```
https://<TWOJ-USERNAME>.github.io/room99-feed-duplicator/output/google-pl-with-test-titles.tsv
```

W **Google Merchant Center → Products → Feeds → Add primary feed** → URL → wklej.

---

## 🎯 DODAWANIE NOWYCH WARIANTÓW — przez formularz (zero edycji plików!)

**Klikasz, wypełniasz 4 pola, Submit. Reszta dzieje się sama.**

### Jak to działa:
1. W repo → zakładka **Issues**
2. **New issue** → wybierz template **"➕ Dodaj wariant tytułu"**
3. Wypełnij formularz:
   - **Grupa produktów** (np. `GARDEN LINE`)
   - **Szukaj w tytule** (np. `ZASŁONA NA TARAS`)
   - **Zastąp przez** (np. `ZASŁONA DO ALTANY`)
   - **Identyfikator wariantu** (np. `t6`)
   - Opcjonalnie notatka
4. **Submit new issue**

**Co się dzieje automatycznie (zero Twojej pracy):**
- GitHub Action czyta Issue → dodaje regułę do config.json → commituje
- Cron regenerate-feed wykona się co godzinę albo uruchom **Actions → Run workflow** ręcznie
- Issue zostaje zamknięte z komentarzem potwierdzającym

### Dezaktywacja wariantu
Otwórz `config.json` online → znajdź wariant → zmień `"active": true` na `false` → Commit.
Wariant zniknie z feed przy następnej regeneracji.

---

## Co dostajesz w duplikatach

| Pole | Wartość |
|---|---|
| `id` | `{original_id}_{dupSuffix}` (np. `9491_t1`) |
| `title` | Original z F&R case-insensitive: `searchInTitle` → `replaceWith` |
| `gtin` | **puste** (poprawka audytora) |
| `mpn` | **puste** |
| `identifier_exists` | `no` |
| `custom_label_0` | `TITLE_TEST` (filtruj w Google Ads) |
| `custom_label_1` | `t1` / `t2` / `m1` (per wariant — segmentacja kampanii) |
| Pozostałe pola | dziedziczone z parent (cena, link, image, availability — auto sync z Shopera) |

---

## Aktualne 5 wariantów GARDEN LINE (działają od pierwszego deploy)

| Suffix | Replace title |
|---|---|
| `t1` | ZASŁONA DO ALTANY |
| `t2` | ZASŁONA NIEPRZEMAKALNA |
| `t3` | ZASŁONA WODOSZCZELNA |
| `t4` | ZASŁONA BALKONOWA |
| `t5` | ZASŁONA DO PERGOLI |

```
72 produkty GARDEN LINE × 5 keywords = 360 duplikatów
+ 1841 oryginałów
= 2201 wierszy w output TSV
```

---

## Monitoring

- **Actions tab**: zobacz historyę cron runs, błędy, sample duplikatów w logach
- **Issues tab**: historia wszystkich dodanych wariantów (każdy ma swój zamknięty Issue)
- **GMC Diagnostics**: tab Products → sprawdź czy duplikaty są approved
- **Google Ads**: filtruj kampanie po `custom_label_0=TITLE_TEST` → porównuj CTR/CPC per `custom_label_1`

---

## Troubleshooting

**Action fails** → Actions tab → kliknij failed run → zobacz logi.

**Issue handler zgłosił błąd** → typowo: sufiks już istnieje. Wybierz inny w nowym Issue.

**Chcę inny interwał** → Edit `.github/workflows/regenerate-feed.yml` → zmień `cron: '0 * * * *'` na `'*/30 * * * *'` (co 30 min).
