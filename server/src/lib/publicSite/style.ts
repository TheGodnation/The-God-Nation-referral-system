// The public website's one stylesheet, written into every page (no extra request, no
// JavaScript). Colours and type follow the approved design preview: deep navy and gold,
// paper-and-ink reading surfaces, serif headings. Fonts are the best serif/sans the visitor's
// phone already has, so no font files are downloaded (a self-hosted font may be added later).
export const CSS = `
:root{--navy:#0f2260;--navy-deep:#0a1740;--navy-mid:#16349a;--gold:#e0b027;--gold-soft:#f2c94c;--paper:#faf7f0;--ink:#1b2234;--muted:#566078;--line:#e4dfd2;--white:#fff;
--serif:'Source Serif 4','Source Serif Pro',Georgia,'Times New Roman',serif;--sans:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 var(--sans)}
a{color:var(--navy-mid)}a:focus-visible,summary:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.skip{position:absolute;left:-999px;top:0;background:var(--gold);color:#1b1500;padding:10px 14px;font-weight:700;z-index:10}.skip:focus{left:8px;top:8px}
header.site{background:var(--white);border-bottom:1px solid var(--line)}
.bar{max-width:1100px;margin:0 auto;padding:12px 18px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between}
.brand{font:700 18px/1.2 var(--serif);color:var(--navy);text-decoration:none;display:flex;align-items:center;gap:9px}
.brand img{width:34px;height:34px;border-radius:8px;display:block}.top-join .js,.lang .ls{display:none}.brand{order:1}.bar .lang{order:3}.bar .top-join{order:4;padding:9px 16px;font-size:14px}
nav.main{order:2;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;font-size:15px;font-weight:600;margin-left:auto}
@media(max-width:700px){.top-join .jl,.lang .ll{display:none}.top-join .js,.lang .ls{display:inline;font-weight:700}.lang{padding:6px 12px}.bar{padding:10px 16px}.brand{font-size:17px}.bar .lang{margin-left:auto}.bar .top-join{margin-left:0}nav.main{order:5;font-size:13.5px;width:100%;margin-left:0;gap:4px 14px;border-top:1px solid var(--line);padding-top:4px;overflow-x:auto;flex-wrap:nowrap;white-space:nowrap}nav.main a{padding:8px 2px}}
nav.main a{color:var(--navy);text-decoration:none;padding:6px 2px}nav.main a[aria-current=page]{border-bottom:2px solid var(--gold)}
.lang{border:1px solid var(--navy);border-radius:999px;padding:3px 12px;font-size:13px}
.btn{display:inline-block;border-radius:12px;padding:12px 20px;font-weight:700;font-size:16px;text-decoration:none;line-height:1.2}
.btn.gold{background:var(--gold);color:#1b1500}.btn.navy{background:var(--navy);color:#fff}.btn.line{border:1.5px solid rgba(255,255,255,.6);color:#fff;margin:10px 8px 0 0}.hero .btn.gold{margin:10px 8px 0 0}
.hero{background:linear-gradient(160deg,var(--navy-deep),var(--navy) 60%,var(--navy-mid));color:#fff}
.hero .in{max-width:1100px;margin:0 auto;padding:44px 18px 48px}
.kicker{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-soft)}.kicker::before{content:"";width:26px;height:1px;background:var(--gold-soft)}
.kicker.dark{color:var(--navy-mid)}.kicker.dark::before{background:var(--navy-mid)}
h1,h2,h3{font-family:var(--serif);color:var(--navy);line-height:1.15;margin:0 0 .5em}
.hero h1{color:#fff;font-size:clamp(30px,6vw,48px);margin:.5em 0 .5em;max-width:18em}.hero p{color:#d6defa;font-size:18px;max-width:38em;margin:0 0 22px}
main{display:block}.wrap{max-width:1100px;margin:0 auto;padding:0 18px}.read{max-width:44em}
section.blk{padding-top:34px;padding-bottom:34px}h2{font-size:clamp(24px,4vw,32px)}h3{font-size:20px}
.grid{display:grid;gap:14px;grid-template-columns:1fr}
@media(min-width:640px){.grid.two{grid-template-columns:1fr 1fr}.grid.three{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--white);border:1px solid var(--line);border-top:3px solid var(--gold);border-radius:12px;padding:16px;text-decoration:none;color:var(--ink);display:block}
.card b{font:700 19px/1.25 var(--serif);color:var(--navy);display:block;margin-bottom:6px}.card span{color:var(--muted);font-size:15px}
.card:hover{box-shadow:0 6px 18px rgba(15,34,96,.12)}
ul.list{padding-left:1.2em;margin:0}ul.list li{margin:.35em 0}
.crumb{font-size:13px;color:var(--muted);padding-top:16px;padding-bottom:2px}.crumb a{color:var(--muted)}
.lead{font:19px/1.6 var(--serif);color:#2a3350}
.callout{background:var(--white);border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:0 12px 12px 0;padding:14px 16px;margin:18px 0}
.join{background:var(--navy-deep);color:#fff;text-align:center;padding:38px 18px}.join h2{color:#fff}.join p{color:#c9d3f2;max-width:36em;margin:0 auto 18px}.join small{display:block;margin-top:14px;color:#9fb0e4}.join small a{color:#fff}
footer.site{background:#080f2c;color:#9fb0e4;font-size:14px;padding:34px 18px 22px}footer.site a{color:#c9d3f2;text-decoration:none}footer.site a:hover{text-decoration:underline}
.fcols{max-width:1100px;margin:0 auto;display:grid;gap:26px;grid-template-columns:1fr}@media(min-width:760px){.fcols{grid-template-columns:1.4fr 1fr 1fr}}
.fcols b{display:block;color:#fff;font:700 14px var(--sans);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}.fcols a{display:block;padding:4px 0}.fcols p{margin:0 0 10px;max-width:30em;line-height:1.6}.fbrand{display:flex;align-items:center;gap:10px;font:700 18px var(--serif);color:#fff;margin-bottom:10px}.fbrand img{width:34px;height:34px;border-radius:8px}
.fbase{max-width:1100px;margin:26px auto 0;padding-top:16px;border-top:1px solid #1b2756;display:flex;flex-wrap:wrap;gap:8px 18px;justify-content:space-between}
.photo{margin:0 0 22px}.photo img{display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 8px 24px rgba(15,34,96,.18)}.photo figcaption{font-size:13px;color:var(--muted);margin-top:8px}
.hero .in.has-photo{display:grid;gap:26px;align-items:center}@media(min-width:820px){.hero .in.has-photo{grid-template-columns:1.3fr .8fr}}.hero .photo{margin:0}.hero .photo img{box-shadow:0 10px 30px rgba(0,0,0,.35)}
.pair{display:grid;gap:16px}@media(min-width:760px){.pair{grid-template-columns:1.5fr 1fr}}.pair .photo{margin:0}.pair .photo img{aspect-ratio:4/3;object-fit:cover;object-position:50% 40%}@media(min-width:760px){.pair{align-items:stretch}.pair .photo{height:100%}.pair .photo img{height:100%;aspect-ratio:auto}}
.about-photo{max-width:320px;margin:0 auto 22px}@media(min-width:760px){.about-photo{float:right;margin:4px 0 18px 30px}}
.photo figcaption{display:flex;flex-direction:column;gap:2px;font-size:14px}.photo figcaption b{font:700 17px var(--serif);color:var(--navy)}.photo figcaption span{color:var(--muted);font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.hero{position:relative;overflow:hidden}.hero::before{content:"";position:absolute;right:-120px;top:-140px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(224,176,39,.22),transparent 68%)}
.hero .in{position:relative}.hero .in.has-photo{padding-top:40px;padding-bottom:44px}
.hero .photo{position:relative;max-width:340px;margin:30px auto 0}.hero .photo img{border:3px solid var(--gold);border-radius:18px;aspect-ratio:3/4;object-fit:cover;object-position:50% 18%}
.hero .photo figcaption{background:rgba(8,15,44,.82);border-radius:12px;padding:10px 14px;margin-top:-58px;position:relative;margin-left:10px;margin-right:10px;backdrop-filter:blur(4px)}.hero .photo figcaption b{color:#fff}.hero .photo figcaption span{color:var(--gold-soft)}
@media(min-width:820px){.hero .in.has-photo{grid-template-columns:1.25fr .75fr;gap:48px}.hero .photo{margin:0 0 0 auto;max-width:360px}.hero h1{font-size:clamp(34px,4.4vw,50px)}}
.motto{background:linear-gradient(180deg,#fff8e1,#faf0cf);border-top:1px solid #ecd68a;border-bottom:1px solid #ecd68a;padding:42px 0;text-align:center}.motto .kicker{justify-content:center;color:#7a5a00}.motto .kicker::before{background:#7a5a00}
.motto blockquote{margin:14px auto 0;max-width:30em}.motto .m1{font:700 clamp(24px,4.6vw,38px)/1.2 var(--serif);color:var(--navy);margin:0 0 12px}.motto .m2{font:italic 19px/1.6 var(--serif);color:#3a3f57;margin:0}
.card.area{position:relative;padding-left:62px}.num{position:absolute;left:14px;top:14px;font:700 22px/1 var(--serif);color:var(--gold);font-style:normal;opacity:.95}.steps .card{padding-left:56px;position:relative}.steps .num{font-size:26px;background:var(--navy);color:var(--gold-soft);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px}
.book{background:linear-gradient(160deg,var(--navy-deep),var(--navy));color:#fff;padding:44px 0}.book .in{display:grid;gap:28px;align-items:center}@media(min-width:820px){.book .in{grid-template-columns:260px 1fr;gap:48px}}
.book .cover{width:210px;height:290px;margin:0 auto;border:2px solid var(--gold);border-radius:6px 12px 12px 6px;background:linear-gradient(150deg,#16349a,#0a1740 70%);box-shadow:10px 14px 30px rgba(0,0,0,.45);display:flex;flex-direction:column;justify-content:space-between;padding:22px 18px;text-align:center;position:relative}.book .cover::before{content:"";position:absolute;left:10px;top:0;bottom:0;width:2px;background:rgba(224,176,39,.45)}
.book .cover .s{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold-soft)}.book .cover .t{font:700 23px/1.12 var(--serif);word-break:normal;color:var(--gold-soft);text-transform:uppercase}.book .cover .a{font:600 11px var(--sans);letter-spacing:.12em;color:#d6defa;text-transform:uppercase}
.book h2{color:#fff;margin-bottom:.3em}.book .sub{font:19px/1.55 var(--serif);color:#dfe6ff;margin:0 0 10px}.book .by{color:#c9d3f2;margin:0 0 10px;font-size:15px}.book p{color:#d6defa}.book .btn{margin:12px 10px 0 0}.book .btn.line{margin-top:12px}
.founder{display:grid;gap:26px;align-items:center}@media(min-width:820px){.founder{grid-template-columns:320px 1fr;gap:56px}}.founder .photo{max-width:320px;margin:0 auto}.founder .photo img{border-radius:16px;aspect-ratio:4/5;object-fit:cover;object-position:50% 20%}.founder p{max-width:34em}
ul.ticks{list-style:none;padding:0;margin:0;display:grid;gap:10px;grid-template-columns:1fr}@media(min-width:720px){ul.ticks{grid-template-columns:1fr 1fr;gap:12px 36px}}ul.ticks li{position:relative;padding-left:30px}ul.ticks li::before{content:"";position:absolute;left:2px;top:.45em;width:12px;height:7px;border-left:3px solid var(--gold);border-bottom:3px solid var(--gold);transform:rotate(-45deg)}
.pill{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:#fff7dc;border:1px solid #ecd68a;border-radius:999px;padding:2px 10px;color:#7a5a00}
`;

export const CSS_ARTICLES = `
.prose{font:18px/1.75 var(--serif);color:#222a3d}.prose h2{margin:1.6em 0 .4em;font-size:26px}.prose h3{margin:1.3em 0 .3em;font-size:21px}.prose p{margin:0 0 1em}.prose ul,.prose ol{margin:0 0 1em;padding-left:1.3em}.prose li{margin:.3em 0}
.prose blockquote{margin:1.2em 0;background:var(--white);border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:0 10px 10px 0;padding:12px 16px;font-style:italic}.prose blockquote p{margin:0}
.prose cite{display:block;font:700 12px/1.4 var(--sans);font-style:normal;letter-spacing:.06em;color:var(--navy-mid);margin-top:6px;text-transform:uppercase}
.byline{font:14px/1.5 var(--sans);color:var(--muted);margin:10px 0 18px}.toc{border-left:3px solid var(--gold);padding:4px 0 4px 14px;margin:0 0 22px;font:15px/1.7 var(--sans)}.toc b{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--navy-mid)}
.hero-img{display:block;max-width:100%;height:auto;border-radius:12px;margin:0 0 20px}
details.faq{background:var(--white);border:1px solid var(--line);border-radius:10px;margin:8px 0}details.faq summary{cursor:pointer;padding:12px 14px;font:600 16px/1.4 var(--sans);color:var(--navy)}details.faq div{padding:0 14px 12px;font:16px/1.6 var(--serif)}
.share{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.share a{border:1px solid var(--line);background:var(--white);border-radius:999px;padding:6px 14px;font:700 13px/1.2 var(--sans);text-decoration:none;color:var(--navy)}.share a.wa{background:#1fa855;border-color:#1fa855;color:#fff}
.card .meta,.meta{display:block;font:13px var(--sans);color:var(--muted);margin-top:8px}ul.cards{list-style:none;padding:0;margin:0;display:grid;gap:14px}ul.cards li{margin:0}
.who{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:26px 0;font:15px/1.6 var(--sans)}.who b{display:block;font:700 18px var(--serif);color:var(--navy)}
`;
