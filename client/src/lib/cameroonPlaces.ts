// Cameroon's places, for the pick-lists: region > division (département) > subdivision (arrondissement /
// commune), and the well-known quarters of the main towns.
//
// Written from knowledge, not copied from an official register: where a name is missing or spelt
// differently, the form always offers "Other — type it", so nobody is ever stuck. To correct or add a
// place, edit the text below (one division per line: "Division: subdivision, subdivision, …").
// Names are the same in English and French, so one spelling is stored (the region values match
// CAMEROON_REGIONS in locations.ts).

const SUBDIVISIONS: Record<string, string> = {
  Adamawa: `
Djérem: Tibati, Ngaoundal
Faro-et-Déo: Tignère, Galim-Tignère, Kontcha, Mayo-Baléo
Mayo-Banyo: Banyo, Bankim, Mayo-Darlé
Mbéré: Meiganga, Dir, Djohong, Ngaoui
Vina: Ngaoundéré I, Ngaoundéré II, Ngaoundéré III, Belel, Mbé, Nganha, Nyambaka, Martap
`,
  Centre: `
Haute-Sanaga: Nanga-Eboko, Bibey, Lembe-Yezoum, Mbandjock, Minta, Nkoteng, Nsem
Lekié: Monatélé, Batchenga, Ebebda, Elig-Mfomo, Evodoula, Lobo, Obala, Okola, Sa'a
Mbam-et-Inoubou: Bafia, Bokito, Deuk, Kiiki, Kon-Yambetta, Makénéné, Ndikiniméki, Nitoukou, Ombessa
Mbam-et-Kim: Ntui, Mbangassina, Ngambè-Tikar, Ngoro, Yoko
Méfou-et-Afamba: Mfou, Afanloum, Assamba, Awaé, Edzendouan, Esse, Nkolafamba, Soa
Méfou-et-Akono: Ngoumou, Akono, Bikok, Mbankomo
Mfoundi: Yaoundé I, Yaoundé II, Yaoundé III, Yaoundé IV, Yaoundé V, Yaoundé VI, Yaoundé VII
Nyong-et-Kéllé: Eséka, Biyouha, Bondjock, Bot-Makak, Dibang, Makak, Matomb, Mbangue, Messondo, Ngog-Mapubi, Nguibassal
Nyong-et-Mfoumou: Akonolinga, Ayos, Endom, Kobdombo, Mengang, Nyakokombo
Nyong-et-So'o: Mbalmayo, Akoeman, Dzeng, Mengueme, Ngomedzap, Nkolmetet
`,
  East: `
Boumba-et-Ngoko: Yokadouma, Gari-Gombo, Moloundou, Salapoumbé
Haut-Nyong: Abong-Mbang, Angossas, Atok, Dimako, Doumaintang, Doumé, Lomié, Messamena, Messok, Mindourou, Ngoyla, Nguelemendouka, Somalomo
Kadey: Batouri, Kette, Mbang, Ndelele, Nguelebok, Ouli
Lom-et-Djérem: Bertoua I, Bertoua II, Bélabo, Bétaré-Oya, Diang, Garoua-Boulaï, Mandjou, Ngoura
`,
  'Far North': `
Diamaré: Maroua I, Maroua II, Maroua III, Bogo, Dargala, Gazawa, Meri, Ndoukoula, Pétté
Logone-et-Chari: Kousséri, Blangoua, Darak, Fotokol, Goulfey, Hile-Alifa, Logone-Birni, Makary, Waza, Zina
Mayo-Danay: Yagoua, Datcheka, Gobo, Guéré, Kai-Kai, Kalfou, Kar-Hay, Maga, Tchatibali, Vélé, Wina
Mayo-Kani: Kaélé, Dziguilao, Guidiguis, Mindif, Moulvoudaye, Taïbong, Touloum
Mayo-Sava: Mora, Kolofata, Tokombéré
Mayo-Tsanaga: Mokolo, Bourrha, Hina, Koza, Mayo-Moskota, Mogodé, Mozogo, Soulédé-Roua
`,
  Littoral: `
Moungo: Nkongsamba I, Nkongsamba II, Nkongsamba III, Baré-Bakem, Bonaléa, Dibombari, Loum, Manjo, Mbanga, Melong, Mombo, Njombé-Penja
Nkam: Yabassi, Ndobian, Nkondjock, Yingui
Sanaga-Maritime: Edéa I, Edéa II, Dibamba, Dizangué, Massock-Songloulou, Mouanko, Ndom, Ngambè, Ngwéi, Nyanon, Pouma
Wouri: Douala I, Douala II, Douala III, Douala IV, Douala V, Douala VI, Manoka
`,
  North: `
Bénoué: Garoua I, Garoua II, Garoua III, Bascheo, Bibemi, Dembo, Demsa, Lagdo, Pitoa, Tcheboa
Faro: Poli, Béka
Mayo-Louti: Guider, Figuil, Mayo-Oulo
Mayo-Rey: Tcholliré, Madingring, Rey-Bouba, Touboro
`,
  'North-West': `
Boyo: Fonfuka, Belo, Bum, Njinikom
Bui: Kumbo, Jakiri, Mbven, Nkor, Noni, Oku
Donga-Mantung: Nkambé, Ako, Misaje, Ndu, Nwa
Menchum: Wum, Fungom, Furu-Awa, Menchum Valley, Zhoa
Mezam: Bamenda I, Bamenda II, Bamenda III, Bafut, Bali, Santa, Tubah
Momo: Mbengwi, Andek, Batibo, Njikwa, Widikum-Menka
Ngoketunjia: Ndop, Babessi, Balikumbat
`,
  South: `
Dja-et-Lobo: Sangmélima, Bengbis, Djoum, Meyomessala, Meyomessi, Mintom, Oveng, Zoétélé
Mvila: Ebolowa I, Ebolowa II, Biwong-Bane, Biwong-Bulu, Efoulan, Mengong, Mvangan, Ngoulemakong
Océan: Kribi I, Kribi II, Akom II, Bipindi, Campo, Lokoundjé, Lolodorf, Mvengue, Niété
Vallée-du-Ntem: Ambam, Kyé-Ossi, Ma'an, Olamzé
`,
  'South-West': `
Fako: Limbe I, Limbe II, Limbe III, Buea, Muyuka, Tiko, West Coast
Koupé-Manengouba: Bangem, Nguti, Tombel
Lebialem: Menji, Alou, Fontem, Wabane
Manyu: Mamfe, Akwaya, Eyumojock, Upper Bayang
Meme: Kumba I, Kumba II, Kumba III, Konye, Mbonge
Ndian: Mundemba, Bamusso, Dikome-Balue, Ekondo-Titi, Idabato, Isangele, Kombo-Abedimo, Kombo-Itindi, Toko
`,
  West: `
Bamboutos: Mbouda, Babadjou, Batcham, Galim
Haut-Nkam: Bafang, Bakou, Banka, Bana, Bandja, Kékem
Hauts-Plateaux: Baham, Bamendjou, Bangou, Batié
Koung-Khi: Bandjoun, Pété-Bandjoun, Poumougné
Menoua: Dschang, Fokoué, Fongo-Tongo, Nkong-Zem, Penka-Michel, Santchou
Mifi: Bafoussam I, Bafoussam II, Bafoussam III
Ndé: Bangangté, Bassamba, Bazou, Tonga
Noun: Foumban, Bangourain, Foumbot, Kouoptamo, Koutaba, Magba, Malantouen, Massangam, Njimom
`,
};

// The well-known quarters of the main towns, set against the town's subdivisions. A town's list is the
// same for each of its subdivisions (people know their quarter by name, not by subdivision).
const TOWN_QUARTERS: { subdivisions: string[]; quarters: string[] }[] = [
  {
    subdivisions: ['Yaoundé I', 'Yaoundé II', 'Yaoundé III', 'Yaoundé IV', 'Yaoundé V', 'Yaoundé VI', 'Yaoundé VII'],
    quarters: [
      'Bastos', 'Biyem-Assi', 'Briqueterie', 'Cité Verte', 'Damas', 'Efoulan', 'Elig-Edzoa', 'Emana', 'Essos', 'Etoudi', 'Messa', 'Mfandena', 'Mimboman', 'Mokolo', 'Mvan', 'Mvog-Ada',
      'Mvog-Betsi', 'Mvog-Mbi', 'Nkolbisson', 'Nkoldongo', 'Nkolndongo', 'Nlongkak', 'Obili', 'Odza', 'Ngousso', 'Nsimeyong', 'Ekounou', 'Tsinga', 'Oyom-Abang', 'Simbock', 'Madagascar', 'Santa Barbara', 'Melen',
    ],
  },
  {
    subdivisions: ['Douala I', 'Douala II', 'Douala III', 'Douala IV', 'Douala V', 'Douala VI'],
    quarters: [
      'Akwa', 'Bali', 'Bepanda', 'Bonabéri', 'Bonamoussadi', 'Bonanjo', 'Bonapriso', 'Bonassama', 'Cité des Palmiers', 'Deido', 'Kotto', 'Logbaba', 'Logpom', 'Makepe', 'Ndogbong', 'New Bell',
      'Nkolouloun', 'PK 14', 'PK 21', 'Japoma', 'Yassa', 'Village', 'Brazzaville', 'Cité SIC', 'Oyack', 'Nylon', 'Ndokoti', 'Soboum', 'Beedi',
    ],
  },
  {
    subdivisions: ['Buea'],
    quarters: ['Molyko', 'Great Soppo', 'Small Soppo', 'Buea Town', 'Bokwaongo', 'Bonduma', 'Muea', 'Bova', 'Bonakanda', 'Sandpit', 'Mile 16', 'Mile 17', 'Check Point', 'Clerks Quarters', 'Bwitingi', 'Tole', 'Wonya Woteke', 'Likoko Membea', 'Ndongo'],
  },
  {
    subdivisions: ['Limbe I', 'Limbe II', 'Limbe III'],
    quarters: ['Down Beach', 'Church Street', 'New Town', 'Mile 4', 'Bota', 'Bimbia', 'Middle Farms', 'Mabeta', 'Batoke', 'Botaland', 'Njonji', 'Mokunda', 'Idenau'],
  },
  {
    subdivisions: ['Kumba I', 'Kumba II', 'Kumba III'],
    quarters: ['Fiango', 'Mbonge Road', 'Buea Road', 'Mile 1', 'Mile 2', 'Kumba Town', 'Three Corners', 'Kosala', 'Barombi Kang', 'Ikiliwindi', 'Mambanda'],
  },
  {
    subdivisions: ['Bamenda I', 'Bamenda II', 'Bamenda III'],
    quarters: [
      'Up Station', 'Commercial Avenue', 'Mankon', 'Ntarinkon', 'Nkwen', 'Ntamulung', 'Bambili', 'Bayelle', 'Mile 2 Nkwen', 'Foncha Street', 'Old Town', 'Ntambeng', 'Azire', 'Mulang', 'Mendankwe', 'Nitob', 'Hospital Roundabout', 'Cow Street', 'Finger Rock',
    ],
  },
  {
    subdivisions: ['Bafoussam I', 'Bafoussam II', 'Bafoussam III'],
    quarters: ['Tamdja', 'Kamkop', 'Djeleng', 'Banengo', 'Tougang', 'Famla', 'Lafé', 'Marché A', 'Marché B', 'Ndiengdam', 'Tchouang', 'Baleng', 'Bamougoum'],
  },
  {
    subdivisions: ['Garoua I', 'Garoua II', 'Garoua III'],
    quarters: ['Roumdé Adjia', 'Foulbéré', 'Poumpoumré', 'Yelwa', 'Lopéré', 'Marouaré', 'Bibémi Road', 'Plateau', 'Pitoa Road', 'Ngaoundéré Road', 'Souari', 'Doualaré'],
  },
  {
    subdivisions: ['Maroua I', 'Maroua II', 'Maroua III'],
    quarters: ['Domayo', 'Doualaré', 'Pitoaré', 'Kakataré', 'Djarengol', 'Dougoï', 'Zokok', 'Founangué', 'Ouro-Tchédé', 'Makabaye', 'Meskine', 'Hardé'],
  },
  {
    subdivisions: ['Ngaoundéré I', 'Ngaoundéré II', 'Ngaoundéré III'],
    quarters: ['Burkina', 'Dang', 'Haoussa', 'Joli Soir', 'Mbideng', 'Baladji', 'Bamyanga', 'Sabongari', 'Béka Hosséré', 'Bini', 'Gada Mabanga', 'Onaref'],
  },
  {
    subdivisions: ['Bertoua I', 'Bertoua II'],
    quarters: ['Mokolo', 'Tigaza', 'Kpokolota', 'Nkolbikon', 'Haoussa', 'Enia', 'Mandjou Road', 'Ndemba', 'Nkoladjom', 'Quartier Administratif'],
  },
  {
    subdivisions: ['Ebolowa I', 'Ebolowa II'],
    quarters: ['Angalé', 'Mekalat', 'Nko\'ovos', 'Mvila', 'Ebolowa Centre', 'Abang', 'Mekok', 'Elon', 'Nkolenyeng'],
  },
  {
    subdivisions: ['Kribi I', 'Kribi II'],
    quarters: ['Mpalla', 'Talla', 'Ngoyè', 'Mokolo', 'Ebome', 'Elabe', 'Grand Batanga', 'Petit Paris', 'Lendi'],
  },
  {
    subdivisions: ['Edéa I', 'Edéa II'],
    quarters: ['Ndjoh', 'Mbanda', 'Kamsar', 'Nkolngo', 'Ngaoundéré', 'Pongo', 'Bonnetamba', 'Ndogbadjeck'],
  },
  {
    subdivisions: ['Nkongsamba I', 'Nkongsamba II', 'Nkongsamba III'],
    quarters: ['Ngwa', 'Quartier 1', 'Quartier 2', 'Manengouba', 'Ndoumou', 'Tonga', 'Ekom', 'Nkapa', 'Mbouroukou'],
  },
  {
    subdivisions: ['Dschang'],
    quarters: ['Foto', 'Mingmeto', 'Ngui', 'Fiankop', 'Tsinkop', 'Keleng', 'Paid', 'Siteu', 'Foreke', 'Lefock', 'Menoua'],
  },
];

export interface PlaceDivision {
  name: string;
  subdivisions: string[];
}

/** The region's divisions, each with its subdivisions (empty when the region is not one of the ten). */
export function divisionsOf(region: string): PlaceDivision[] {
  const text = SUBDIVISIONS[region];
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, rest] = line.split(':');
      return { name: name.trim(), subdivisions: (rest ?? '').split(',').map((s) => s.trim()).filter(Boolean) };
    });
}

export function subdivisionsOf(region: string, division: string): string[] {
  return divisionsOf(region).find((d) => d.name === division)?.subdivisions ?? [];
}

/** The quarters known for a town's subdivision (empty when there is no list: the quarter is then typed). */
export function quartersOf(subdivision: string): string[] {
  return TOWN_QUARTERS.find((t) => t.subdivisions.includes(subdivision))?.quarters.slice().sort((a, b) => a.localeCompare(b)) ?? [];
}

export const CAMEROON_PLACE_COUNTS = (() => {
  let divisions = 0;
  let subdivisions = 0;
  for (const region of Object.keys(SUBDIVISIONS)) {
    const list = divisionsOf(region);
    divisions += list.length;
    subdivisions += list.reduce((n, d) => n + d.subdivisions.length, 0);
  }
  return { regions: Object.keys(SUBDIVISIONS).length, divisions, subdivisions };
})();
