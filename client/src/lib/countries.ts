// Countries and their phone codes, for the number box where the country is chosen from a list
// (Cameroon first) and the code is added by itself. Names come from the browser in the reader's
// language; the code is the number a phone dials first (without the "+").

const RAW =
  'AF:93,AL:355,DZ:213,AD:376,AO:244,AR:54,AM:374,AW:297,AU:61,AT:43,AZ:994,BS:1,BH:973,BD:880,BB:1,BY:375,BE:32,BZ:501,BJ:229,BM:1,BT:975,BO:591,BA:387,BW:267,BR:55,BN:673,BG:359,BF:226,BI:257,KH:855,CM:237,CA:1,CV:238,KY:1,CF:236,TD:235,CL:56,CN:86,CO:57,KM:269,CG:242,CD:243,CK:682,CR:506,CI:225,HR:385,CU:53,CW:599,CY:357,CZ:420,DK:45,DJ:253,DO:1,EC:593,EG:20,SV:503,GQ:240,ER:291,EE:372,SZ:268,ET:251,FJ:679,FI:358,FR:33,GF:594,PF:689,GA:241,GM:220,GE:995,DE:49,GH:233,GI:350,GR:30,GL:299,GP:590,GU:1,GT:502,GN:224,GW:245,GY:592,HT:509,HN:504,HK:852,HU:36,IS:354,IN:91,ID:62,IR:98,IQ:964,IE:353,IL:972,IT:39,JM:1,JP:81,JO:962,KZ:7,KE:254,KI:686,XK:383,KW:965,KG:996,LA:856,LV:371,LB:961,LS:266,LR:231,LY:218,LI:423,LT:370,LU:352,MO:853,MG:261,MW:265,MY:60,MV:960,ML:223,MT:356,MH:692,MQ:596,MR:222,MU:230,YT:262,MX:52,FM:691,MD:373,MC:377,MN:976,ME:382,MA:212,MZ:258,MM:95,NA:264,NR:674,NP:977,NL:31,NC:687,NZ:64,NI:505,NE:227,NG:234,KP:850,MK:389,NO:47,OM:968,PK:92,PW:680,PS:970,PA:507,PG:675,PY:595,PE:51,PH:63,PL:48,PT:351,PR:1,QA:974,RE:262,RO:40,RU:7,RW:250,WS:685,SM:378,ST:239,SA:966,SN:221,RS:381,SC:248,SL:232,SG:65,SK:421,SI:386,SB:677,SO:252,ZA:27,KR:82,SS:211,ES:34,LK:94,SD:249,SR:597,SE:46,CH:41,SY:963,TW:886,TJ:992,TZ:255,TH:66,TL:670,TG:228,TO:676,TT:1,TN:216,TR:90,TM:993,TV:688,UG:256,UA:380,AE:971,GB:44,US:1,UY:598,UZ:998,VU:678,VA:379,VE:58,VN:84,YE:967,ZM:260,ZW:263';

export interface Country {
  iso: string;
  dial: string;
}

export const COUNTRIES: Country[] = RAW.split(',').map((p) => {
  const [iso, dial] = p.split(':');
  return { iso, dial };
});

export const DEFAULT_COUNTRY = 'CM';

export const dialOf = (iso: string): string => COUNTRIES.find((c) => c.iso === iso)?.dial ?? '237';

/** 🇨🇲 for "CM" (a flag is two regional-indicator letters). */
export const flagOf = (iso: string): string => String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 127397 + ch.charCodeAt(0)));

/** The country's name in the reader's language (the browser knows them), or its letters. */
export function countryName(iso: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/** The list for the chooser: Cameroon first, then the others in the order of their names. */
export function sortedCountries(lang: string): (Country & { name: string })[] {
  const named = COUNTRIES.map((c) => ({ ...c, name: countryName(c.iso, lang) }));
  const first = named.find((c) => c.iso === DEFAULT_COUNTRY)!;
  const rest = named.filter((c) => c.iso !== DEFAULT_COUNTRY).sort((a, b) => a.name.localeCompare(b.name, lang));
  return [first, ...rest];
}

/** When someone types or pastes a number that starts with "+": which country it is, and the rest of the number. */
export function splitInternational(typed: string): { iso: string; national: string } | null {
  const digits = typed.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return null;
  const all = digits.slice(1);
  // The longest code that fits (so +237… is Cameroon, not a shorter code).
  let best: Country | null = null;
  for (const c of COUNTRIES) if (all.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  if (!best) return null;
  // Cameroon, then the US for "+1…" (other +1 places are chosen by hand), then the first country with that code.
  const same = COUNTRIES.filter((c) => c.dial === best!.dial);
  const pick = same.find((c) => c.iso === DEFAULT_COUNTRY) ?? same.find((c) => c.iso === 'US') ?? same[0];
  return { iso: pick.iso, national: all.slice(best.dial.length) };
}

/** The number to send to the server: "+" + the code + the number as typed (a leading 0 dropped), or "" when nothing was typed. */
export function fullNumber(iso: string, national: string): string {
  let digits = national.replace(/\D/g, '');
  if (!digits) return '';
  // In international form the "0" some countries put first is not dialled (Italy keeps its own).
  if (digits.startsWith('0') && iso !== 'IT') digits = digits.replace(/^0+/, '');
  return digits ? `+${dialOf(iso)}${digits}` : '';
}
