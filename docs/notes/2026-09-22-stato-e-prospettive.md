# Stato del progetto e prospettive di sviluppo

Rapporto del 2026-09-22. Ricognizione sullo stato reale del monorepo, sulle issue
aperte e sulle direzioni di sviluppo proposte.

## Premessa

La parte più solida del sistema è oggi la **spina dorsale di esecuzione**. I rami
di lavoro recenti (`avg-2n7`, `avg-grf`, `avg-0v5`) hanno prodotto un unico
servizio di esecuzione, un solo journal, una tabella di transizione dichiarata in
due punti ma vincolata a restare identica, lease che non vengono più persi, e un
replay che sopravvive a una scrittura perduta. Quel lavoro è finito ed è buono.

L'instabilità non è più lì: si è spostata ai bordi del sistema e sulla mappa che
lo descrive.

Sono emerse quattro cose che contano davvero, più una coda lunga di problemi
minori.

---

# Parte 1 — Cosa manca per la stabilità

## 1. Il tracker è la principale fonte di instabilità

`bd list` mostra **42 issue aperte, di cui 17 a priorità P0**. Ma almeno undici di
quelle P0 — `avg-86w`, `avg-r7a`, `avg-doh`, `avg-5g5`, `avg-qft`, `avg-dff`,
`avg-gjp`, `avg-hv5`, `avg-q5a`, `avg-pv6`, `avg-lsh` con i suoi quattro
sotto-task — descrivono **undici repository separati che sono stati consolidati in
questo monorepo il 2026-08-14**.

Lo dice `avg-86w` stessa, che si chiude con: "TODO: migrare il programma beads
E1-E4". Quella migrazione non è mai avvenuta, quindi il vecchio programma è
rimasto lì, a P0.

Il risultato: `bd ready` riporta 20 issue pronte e le prime sei sono finzione.
`avg-lsh.1` chiede di "congelare library come library-legacy" — ma la library è
stata migrata al layout 2 da tempo. Non si può stabilire una priorità su un elenco
in cui le voci più rumorose descrivono un mondo che non esiste più.

**È l'intervento più economico e con la leva più alta di tutto l'elenco.** Una
sessione: chiudere ciò che è fatto, riscrivere ciò che è sopravvissuto, eliminare
gli epic per-repository. Tutto ciò che segue diventa decidibile solo dopo.

## 2. Il posto del compilatore è vuoto

Questo è il vero buco architetturale, e a dirlo è una nota di progetto già scritta
in casa (`docs/notes/remotion-composer-design.md`):

> L'ADR-0009 dice che un composer "valida quella timeline, compila i filter graph
> di FFmpeg, esegue FFmpeg". Il validatore esiste — 929 righe. **Nulla compila una
> `Timeline`.**

Ciò che effettivamente produce gli episodi è `composeEpisodeVideo()` — una funzione
privata dentro `studio/agent/src/capability-tools.ts` che invoca ffmpeg con
`spawnSync`, fa il glob di `assets/images` e normalizza a mano le dimensioni dei
fotogrammi. Lo schema tipizzato della edit-timeline è dichiarato canonico e non è
consumato da nessuno.

Quindi: l'assetto che l'ADR-0009 era stato scritto per impedire è esattamente
quello che gira in produzione.

La questione va molto oltre l'ordine formale, perché **ogni singola funzionalità di
controllo creativo descritta nella Parte 2 dipende dal fatto che una timeline
tipizzata sia la fonte di verità.** "Discutere e modificare ogni fotogramma" non è
implementabile contro una funzione che fa il glob di una cartella. Riempire questo
posto vuoto è l'elemento portante dell'intera roadmap.

## 3. Il contratto del workspace e la library reale non concordano

Ho confrontato il contratto con ciò che sta effettivamente su disco, su tutti e 20
gli episodi:

| Cartella | Episodi che la usano | Prevista dal contratto? |
|---|---|---|
| `artifacts`, `assets` | 20 | sì |
| `reviews` | 18 | sì |
| `output` | 13 | sì |
| **`production`** | **12** | **no** |
| `journal` | 11 | sì |
| `source`, `prompts`, `attempts` | 10 | sì |
| `.snapshots`, `.revisions`, `private` | 1 ciascuna | no |

`production/` è presente in **più episodi di `journal/`** e il contratto non ne ha
mai sentito parlare. `giulio-cesare` tiene le sue scene animate in
`production/animated-scenes/s04.mp4`.

Questa è la causa profonda sia di `avg-t7i` ("artifactExists non trova artefatti
reali in tre modi diversi") sia di `avg-7he` ("gli episodi esistenti non hanno
journal"). Il resolver non ha un bug sottile: sta guardando in un posto che metà
del lavoro reale non usa.

Correggere `artifactExists` senza riconciliare questo significa solo spostare la
discrepanza.

**Va deciso in un senso solo:** o `production/` entra nel contratto, o una
migrazione la sposta dentro `artifacts/`. Tenere entrambe le cose è ciò che ha
prodotto il bug.

## 4. L'approvazione non è autenticata, e nessuno viene nemmeno interpellato

`avg-qr4.3` è P0, e la sua nota contiene il problema più acuto:

> **Nessuno scrive più `approval-requested`.** Il vecchio loop del gateway lo
> scriveva quando si bloccava; il servizio di esecuzione non lo ha mai fatto e
> `runAutopilot` non esiste più. La sicurezza è coperta — una dipendenza senza
> record viene rifiutata — ma la richiesta visibile all'essere umano è sparita.

Quindi il sistema si rifiuta correttamente di procedere, e correttamente non ti
dice mai che ti sta aspettando. Per uno strumento la cui premessa è il controllo
creativo umano, è la metà sbagliata a funzionare.

In più `cmdApprove` registra `actor: human` indipendentemente da chi ha chiamato.

## La coda lunga (reale, piccola, stessa famiglia)

- `avg-91o` — le prenotazioni di budget vengono prese e mai rilasciate
- `avg-j6q` — il gateway **fallisce in apertura** quando non riesce a leggere il journal
- `avg-bnj` — `/execute` risponde `ok:true` anche quando non è stato eseguito nulla
- `avg-82z` — flake della suite di test alla radice

Sono la stessa specie che stai eliminando da tre rami di lavoro: **superfici che
dichiarano qualcosa di diverso da ciò che contengono.** Presi singolarmente sono
piccoli. `avg-j6q` è quello che non lascerei lì, perché fallire in apertura su un
gate è il modo in cui una revisione viene saltata in silenzio.

## Percorso minimo verso "stabile e architetturalmente sano"

1. Bonifica del tracker — una sessione, sblocca ogni successiva decisione
2. Riconciliare `production/` nel contratto, poi `avg-t7i`, poi `avg-7he`
3. `avg-j6q`, `avg-bnj`, `avg-91o` — il terzetto del "fail-open"
4. `avg-qr4.3` — ricevute di approvazione **e** il record della richiesta
5. **Il compilatore di timeline** — la porta d'accesso a tutta la Parte 2

Su `avg-33r` (candidati, selezione atomica, propagazione della staleness), che
aspetta una tua decisione: **va costruito.** Le "take" nella visione di controllo
creativo *sono* candidati più selezione. Non è una deviazione, è il modello dati di
`avg-qr4.6`.

---

# Parte 2 — Sviluppi futuri

Le tue sette proposte, nell'ordine in cui le affronterei davvero, non nell'ordine in
cui le hai elencate.

## La tua #5 (contesto di serie e canale) — da fare per prima, è già fatta a metà

È l'elemento di maggior valore che hai nominato ed è molto più vicino di quanto
sembri. `workspace-authoring.ts` crea già `characters/`, `visual-bible/`, `brand/`,
`references/`, `voices/`, `templates/`. `layout.mjs` le dichiara come
`CHANNEL_KNOWLEDGE` e `SERIES_KNOWLEDGE`.

**Nulla legge niente di tutto ciò.** Ho cercato: `visual-bible.md` viene scritto
come stub di una riga, elencato dalla UI web come nome di file, e mai più aperto. Il
canone ha uno scaffale e nessun lettore.

E c'è una ragione strutturale per cui non può essere letto: il campo `inputs:` di un
manifest di pipeline nomina *contratti di artefatto prodotti da altri stage*
(`contract: brief.md`). **Non esiste alcuno slot per la conoscenza a livello di
serie o di canale.** Uno stage non può letteralmente dichiarare "io leggo la bibbia
visiva".

La correzione è piccola e sblocca tutto il resto: aggiungere un blocco `context:` al
manifest che nomini la conoscenza di canale e serie, e risolverlo dentro
`pipeline.snapshot.yaml` come ogni altro binding. Fatto questo, il canone diventa
dato di produzione congelato, versionato e revisionabile, esattamente come tutto il
resto.

## La tua #7 (agente di sviluppo affiancato) — la vittoria più economica, da fare presto

Tutto ciò che gli serve esiste già: beads, 33 ADR, la cartella delle specifiche e
dei piani, il workflow superpowers. È un'estensione Pi più una skill che conosce le
convenzioni del repository. Ripaga ogni voce sottostante. La metterei al secondo
posto puramente per ritorno sull'investimento.

## La tua #4 (interrogare a fondo l'utente alla creazione) — viene dopo la #5

Istinto giusto, ordine sbagliato. Se intervisti l'utente oggi, le risposte finiscono
in un file che nessuno legge. Dopo la #5, l'intervista ha una destinazione.

La metà che hai sottovalutato: "progettare una pipeline precisa che segue le
convenzioni" significa che **la creazione di pipeline diventa una capacità
dell'agente.** Oggi le pipeline sono YAML scritto a mano (ce ne sono quattro). È una
funzionalità vera e merita una propria specifica — il validatore e le fixture in
`studio/pipelines` ti danno già le barriere di sicurezza contro cui generare.

## La tua #2 (molti strumenti e modelli) — serve prima il registry

`capability-tools.ts` importa direttamente `@av/fal-media` e `@av/codex-image` e
sceglie il provider con `resolveImageProvider`. `compose.config.json` dichiara
correttamente le capability, ma l'agente non ci passa attraverso. Aggiungere oggi un
provider significa aggiungere l'ennesimo import cablato a un file già grande.

`avg-qr4.4` (registry dichiarativo degli adapter) e `avg-50j` (kit di conformità —
"aggiungere un provider" vuol dire "passare la suite") sono esattamente giusti. Da
fare prima del terzo provider, non dopo il quinto.

## La tua #3 (workspace libero, scena per scena) — una sola correzione di rotta

È l'unica proposta su cui obietterei all'impostazione. "Senza seguire una pipeline,
senza restare in una serie" è la *esperienza utente* giusta e l'*implementazione*
sbagliata. Se costruisci una modalità davvero priva di pipeline, biforchi il sistema
in due modelli di esecuzione, e quello libero non ha journal, né provenance, né
lease, né revisione — cioè butta via esattamente ciò che hai passato mesi a
costruire.

**Fallo come un workspace la cui pipeline è banale, non assente:**
`library/_scratch/<nome>/` come episodio vero che esegue una pipeline `freeform` —
un solo stage editoriale, autopilot disattivato, chiamate arbitrarie alle capability
consentite, tutto registrato nel journal. Zero cerimoniale per l'utente, stessa
spina dorsale sotto. Hai già `_media` ed `_exports` come radici riservate, e un
canale `studio-tests` che fa qualcosa di adiacente.

Stessa risposta per "usare qualunque strumento mi piaccia": quello è il registry
degli adapter, non una via di fuga.

## La tua #6 (git per canale) — sì, ma va deciso cosa si committa

Una preoccupazione che merita attenzione. L'ADR-0021 stabilisce che i media generati
sono immutabili e **non** committati automaticamente, per una buona ragione: il solo
`giulio-cesare` contiene una dozzina di mp4. Un repository per canale che committa
"i cambiamenti" diventa inutilizzabile nel giro di pochi episodi.

**Committare solo il livello editoriale e dichiarativo** — `episode.yaml`,
`pipeline.snapshot.yaml`, script, brief, la timeline, `journal/events.jsonl`, le
revisioni, la bibbia visiva. Mai i media: quelli restano indirizzati per contenuto
su disco e referenziati per hash.

Fatto così ha valore reale: storia creativa diffabile, possibilità di ramificare un
episodio per provare un montaggio diverso, ripristino di uno script. Ed è meglio
farlo *dopo* che esiste la timeline, perché la timeline è l'artefatto che più merita
di essere versionato.

## La tua #1 (interfaccia terminale più curata) — da mettere per ultima

La costruiresti due volte. L'interfaccia dovrebbe presentare inquadrature, take,
canone e anteprime — nessuna delle quali esiste ancora. `tui-status.ts` c'è; lo
lascerei stare finché non c'è un modello migliore da rappresentare.

---

## Quattro aggiunte mie

**Un ciclo di anteprima.** Il vero vantaggio di Higgsfield non è il suo parco
modelli, è la velocità di iterazione. Remotion Studio ti dà l'anteprima dal vivo di
una timeline praticamente gratis. È l'unica funzionalità che rende "discutere ogni
fotogramma" una cosa vera invece che un'aspirazione — e arriva in dotazione con il
riempimento del posto del compilatore, che è un argomento in più per farlo per
primo.

**Budget visibile, per serie.** `BudgetGuard` esiste, perde prenotazioni
(`avg-91o`), e nessuno mostra un numero. "Genera dieci video da dieci link" senza
supervisione e senza tetto visibile è il modo di fallire che costa denaro vero prima
che te ne accorga.

**Il contratto di ingresso dell'autopilot.** Il tuo stesso esempio rivela un pezzo
mancante: dieci link che diventano dieci episodi richiedono un *gestore di sorgenti*
a livello di serie e una *coda*. Oggi creeresti dieci episodi a mano. Il layout ha
già `sources/` a livello di serie — vuota, non letta, stessa storia della bibbia.
Merita una specifica propria; è la differenza tra "autopilot" e "un ciclo che devo
sorvegliare".

**Provenance uniforme.** `pipeline.snapshot.yaml` congela le versioni di contratti e
skill, e `fal-media` registra provenance e costo. Ma la riproducibilità con provider
generativi richiede **seed, versione del modello e prompt registrati per ogni
artefatto, in modo uniforme su tutti i provider.** Rendilo un requisito del kit di
conformità (`avg-50j`) e "rigenera l'inquadratura 4 esattamente com'era" diventa
possibile invece che auspicabile.

---

## Un'osservazione conclusiva

I fattori differenzianti che hai nominato — aperto, locale, nativo sul filesystem,
orientato agli agenti, e *i formati come concetto di prima classe* — sono reali, e il
modello serie/canale è davvero la cosa che Higgsfield non ha.

L'unica cosa che potrebbe ucciderlo in silenzio è che l'agente diventi il monolite.
`capability-tools.ts` importa già due provider direttamente, contiene il composer
ffmpeg che l'ADR-0009 vietava, ed è il posto in cui le nuove capability vengono
naturalmente aggiunte. Ogni voce della Parte 2 o toglie lavoro da quel file
(registry, compilatore, risoluzione del contesto) o ne aggiunge altro. È quello il
bivio architetturale da tenere d'occhio.
