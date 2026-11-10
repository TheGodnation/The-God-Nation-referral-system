// Words and structure of the public website (Phase 2 foundation).
//
// English is the ministry's own wording from the project brief (mission, vision, the six
// knowledge divisions and their subjects). The French was drafted by the developer and is
// NOT yet reviewed: every French page carries `frReviewed: false` until the ministry's French
// reviewer approves it, and unreviewed French pages are served "noindex" and left out of the
// sitemap and the language links (so a draft translation is never the institution's public face).

export type Lang = 'en' | 'fr';
export const LANGS: Lang[] = ['en', 'fr'];

export const MISSION: Record<Lang, string> = {
  en: 'The God Nation Media and Leadership Academy exists to bring together citizens of the Kingdom of God and equip them spiritually and technically to become effective carriers of the Gospel of the Kingdom through modern media.',
  fr: 'The God Nation Media and Leadership Academy existe pour rassembler les citoyens du Royaume de Dieu et les équiper, spirituellement et techniquement, afin qu’ils deviennent des porteurs efficaces de l’Évangile du Royaume par les médias modernes.',
};
export const VISION: Record<Lang, string> = {
  en: 'Our vision is to equip Kingdom citizens who make disciples who make disciples, thereby taking the Gospel of the Kingdom to the ends of the earth.',
  fr: 'Notre vision est d’équiper des citoyens du Royaume qui font des disciples qui font des disciples, portant ainsi l’Évangile du Royaume jusqu’aux extrémités de la terre.',
};

/** The About page, in the founder's own words (sent 10 November 2026). The French was translated by the developer and is for the founder to read. */
export interface AboutText {
  who: { title: string; paras: string[] };
  calling: { title: string; paras: string[] };
  vision: { title: string; paras: string[] };
  action: { title: string; intro: string; list: string[]; closing: string };
  mission: { title: string; text: string };
  motto: { title: string; lead: string; text: string };
  scripture: { title: string; quote: string; ref: string };
}
export const ABOUT: Record<Lang, AboutText> = {
  en: {
    who: {
      title: 'Who we are',
      paras: [
        'The God Nation exists to bring together citizens of the Kingdom of God and equip them spiritually and technically to become effective carriers of the Gospel of the Kingdom through modern media.',
        'We are building a community of trained and equipped Kingdom ambassadors who work together to take this message to people everywhere.',
        'Through spiritual formation, leadership development and practical digital media training, we prepare believers to use modern communication platforms to reach lives, spread the Gospel and advance God’s Kingdom to the ends of the earth.',
      ],
    },
    calling: {
      title: 'Our calling',
      paras: [
        'This work grew out of many years of personal encounters with Christ, spiritual visitations and divine dealings with my family. Through these encounters, a clear mandate emerged: to provoke a spiritual revival in Cameroon that will spread throughout Africa and ultimately reach the nations of the world.',
        'We believe that God has destined a generation of believers in Cameroon to play a significant role in spearheading this revival. Our vision is to identify, gather, teach and prepare this generation to fulfil its part in God’s purpose.',
        'We are committed to bringing this revival army together, grounding its members in the truths of the Kingdom of God, equipping them with spiritual understanding and practical skills, and mobilizing them to carry the Gospel beyond the walls of traditional church gatherings.',
      ],
    },
    vision: {
      title: 'Our vision',
      paras: [
        'We envision a united, spiritually grounded and technically equipped generation of Kingdom Citizens, gathered and mobilized to take the Gospel of the Kingdom to the ends of the earth through modern media.',
        'We believe that modern media provides an unprecedented opportunity to reach people, influence lives and spread the message of the Kingdom across geographical boundaries.',
        'From Cameroon to Africa and to the nations of the world, we are preparing and mobilizing Kingdom ambassadors to work together in fulfilling this mandate.',
      ],
    },
    action: {
      title: 'Our vision in action',
      intro: 'To fulfil this vision, we are building our own digital community—a place where citizens of the Kingdom of God can learn, grow, connect, receive training and prepare for effective service. Through spiritual training, leadership development and digital media systems, we equip Kingdom ambassadors to use:',
      list: ['Social media platforms.', 'Videos and online teachings.', 'Digital books and publications.', 'Modern communication technologies.', 'Other digital tools for spreading the Gospel.'],
      closing: 'Our goal is not simply to build a media team. We are preparing people, developing leaders and building a united community of Kingdom ambassadors committed to taking the Gospel to the nations.',
    },
    mission: { title: 'Our mission', text: 'To gather, train, equip and mobilize citizens of the Kingdom of God spiritually and technically to become effective carriers of the Gospel of the Kingdom through modern media.' },
    motto: { title: 'Our motto', lead: 'Go into the digital media spaces where billions gather.', text: 'Make disciples who make disciples, thereby taking the Gospel of the Kingdom to the ends of the earth.' },
    scripture: { title: 'Our scriptural foundation', quote: '“Go ye therefore, and teach all nations…”', ref: 'Matthew 28:19' },
  },
  fr: {
    who: {
      title: 'Qui nous sommes',
      paras: [
        'The God Nation existe pour rassembler les citoyens du Royaume de Dieu et les équiper, spirituellement et techniquement, afin qu’ils deviennent des porteurs efficaces de l’Évangile du Royaume par les médias modernes.',
        'Nous bâtissons une communauté d’ambassadeurs du Royaume formés et équipés, qui travaillent ensemble pour porter ce message aux gens partout.',
        'Par la formation spirituelle, le développement du leadership et la formation pratique aux médias numériques, nous préparons les croyants à utiliser les plateformes de communication modernes pour toucher des vies, répandre l’Évangile et faire avancer le Royaume de Dieu jusqu’aux extrémités de la terre.',
      ],
    },
    calling: {
      title: 'Notre appel',
      paras: [
        'Cette œuvre est née de nombreuses années de rencontres personnelles avec Christ, de visitations spirituelles et d’interventions divines dans ma famille. De ces rencontres s’est dégagé un mandat clair : provoquer un réveil spirituel au Cameroun, qui se répandra dans toute l’Afrique et atteindra finalement les nations du monde.',
        'Nous croyons que Dieu a destiné une génération de croyants au Cameroun à jouer un rôle important à la tête de ce réveil. Notre vision est d’identifier, de rassembler, d’enseigner et de préparer cette génération afin qu’elle accomplisse sa part dans le dessein de Dieu.',
        'Nous nous engageons à rassembler cette armée du réveil, à enraciner ses membres dans les vérités du Royaume de Dieu, à les équiper d’une compréhension spirituelle et de compétences pratiques, et à les mobiliser pour porter l’Évangile au-delà des murs des rassemblements d’église traditionnels.',
      ],
    },
    vision: {
      title: 'Notre vision',
      paras: [
        'Nous envisageons une génération de citoyens du Royaume unie, solidement ancrée spirituellement et équipée techniquement, rassemblée et mobilisée pour porter l’Évangile du Royaume jusqu’aux extrémités de la terre par les médias modernes.',
        'Nous croyons que les médias modernes offrent une occasion sans précédent de toucher les gens, d’influencer des vies et de répandre le message du Royaume au-delà des frontières géographiques.',
        'Du Cameroun à l’Afrique et aux nations du monde, nous préparons et mobilisons des ambassadeurs du Royaume pour qu’ils travaillent ensemble à accomplir ce mandat.',
      ],
    },
    action: {
      title: 'Notre vision en action',
      intro: 'Pour accomplir cette vision, nous bâtissons notre propre communauté numérique, un lieu où les citoyens du Royaume de Dieu peuvent apprendre, grandir, se connecter, recevoir une formation et se préparer à un service efficace. Par la formation spirituelle, le développement du leadership et des systèmes de médias numériques, nous équipons les ambassadeurs du Royaume pour qu’ils utilisent :',
      list: ['Les plateformes de réseaux sociaux.', 'Les vidéos et les enseignements en ligne.', 'Les livres et publications numériques.', 'Les technologies de communication modernes.', 'D’autres outils numériques pour répandre l’Évangile.'],
      closing: 'Notre but n’est pas simplement de bâtir une équipe médias. Nous préparons des personnes, nous formons des leaders et nous bâtissons une communauté unie d’ambassadeurs du Royaume engagés à porter l’Évangile aux nations.',
    },
    mission: { title: 'Notre mission', text: 'Rassembler, former, équiper et mobiliser les citoyens du Royaume de Dieu, spirituellement et techniquement, afin qu’ils deviennent des porteurs efficaces de l’Évangile du Royaume par les médias modernes.' },
    motto: { title: 'Notre devise', lead: 'Allez dans les espaces des médias numériques où des milliards de personnes se rassemblent.', text: 'Faites des disciples qui font des disciples, portant ainsi l’Évangile du Royaume jusqu’aux extrémités de la terre.' },
    scripture: { title: 'Notre fondement biblique', quote: '« Allez, faites de toutes les nations des disciples… »', ref: 'Matthieu 28.19' },
  },
};

export const WHAT_WE_DO: Record<Lang, string[]> = {
  en: ['Kingdom education', 'Kingdom citizenship and identity', 'Christian leadership development', 'Spiritual growth and discipleship', 'Books and educational publications', 'Digital media and evangelism', 'Equipping believers to become effective ambassadors of the Kingdom', 'Building a community that supports, teaches and develops its members'],
  fr: ['L’éducation du Royaume', 'La citoyenneté et l’identité du Royaume', 'Le développement du leadership chrétien', 'La croissance spirituelle et le discipulat', 'Les livres et publications éducatives', 'Les médias numériques et l’évangélisation', 'Équiper les croyants pour qu’ils deviennent des ambassadeurs efficaces du Royaume', 'Bâtir une communauté qui soutient, enseigne et fait grandir ses membres'],
};

/** The ministry's motto, in the founder's own words (also on the app's About page). */
export const MOTTO: Record<Lang, { lead: string; text: string }> = {
  en: { lead: 'Go into the digital media spaces where billions gather.', text: 'Make disciples who make disciples, thereby taking the Gospel of the Kingdom to the ends of the earth.' },
  fr: { lead: 'Allez dans les espaces des médias numériques où des milliards de personnes se rassemblent.', text: 'Faites des disciples qui font des disciples, portant ainsi l’Évangile du Royaume jusqu’aux extrémités de la terre.' },
};

/** The founder. Facts taken from the ministry's own book cover and mission. */
export const FOUNDER = { name: 'Evangelist Stanley A. Ndoh', nameFr: 'Évangéliste Stanley A. Ndoh' };
export const founderName = (l: Lang) => (l === 'fr' ? FOUNDER.nameFr : FOUNDER.name);

/** The Kingdom Series. Titles, subtitles and taglines are as printed on each cover, in each language. */
export interface BookCover { src: string; w: number; h: number }
export interface SiteBook {
  key: string;
  /** The book's page address in each language (/en/books/<slug>/). */
  slug: Record<Lang, string>;
  title: Record<Lang, string>;
  series: Record<Lang, string>;
  subtitle: Record<Lang, string>;
  tagline: Record<Lang, string>;
  cover: Record<Lang, BookCover>;
  /** Only the first book is opened to registered members in the Leadership School so far; no availability is claimed for the others. */
  inSchool: boolean;
}
export const BOOKS: SiteBook[] = [
  {
    key: 'restoration-of-dominion',
    slug: { en: 'the-restoration-of-dominion', fr: 'la-restauration-de-la-domination' },
    title: { en: 'The Restoration of Dominion', fr: 'La Restauration de la Domination' },
    series: { en: 'The Kingdom Series · Book One', fr: 'La Série du Royaume · Livre un' },
    subtitle: {
      en: 'Understanding the Kingdom of Heaven and the Kingdom of God as the government of God and its manifestation on earth through its citizens.',
      fr: 'Comprendre le Royaume de Dieu et le Royaume des Cieux et sa manifestation sur terre à travers ses citoyens.',
    },
    tagline: { en: 'A book for Kingdom people, raising Kingdom impact.', fr: 'Un livre pour le peuple du Royaume, produisant un impact du Royaume.' },
    cover: { en: { src: '/site/book1-en.webp', w: 520, h: 780 }, fr: { src: '/site/book1-fr.webp', w: 520, h: 780 } },
    inSchool: true,
  },
  {
    key: 'doorway-into-the-kingdom',
    slug: { en: 'the-doorway-into-the-kingdom', fr: 'la-porte-d-entree-dans-le-royaume-de-dieu' },
    title: { en: 'The Doorway into the Kingdom', fr: 'La Porte d’entrée dans le Royaume de Dieu' },
    series: { en: 'The Kingdom Series · Book Two', fr: 'La Série du Royaume · Livre deux' },
    subtitle: { en: 'Fundamental principles of the Kingdom of God: repent, be baptized, receive the Holy Spirit.', fr: 'Principes fondamentaux du Royaume de Dieu : repentez-vous, soyez baptisés, recevez le Saint-Esprit.' },
    tagline: { en: 'The path to God’s government begins here.', fr: 'Le chemin du retour au gouvernement de Dieu commence ici.' },
    cover: { en: { src: '/site/book2-en.webp', w: 520, h: 780 }, fr: { src: '/site/book2-fr.webp', w: 520, h: 780 } },
    inSchool: false,
  },
];

export interface Division {
  key: string;
  slug: Record<Lang, string>;
  name: Record<Lang, string>;
  blurb: Record<Lang, string>;
  topics: Record<Lang, string[]>;
  /** Becomes true when the division has published articles; empty divisions are served noindex. */
  hasArticles: boolean;
}

export const DIVISIONS: Division[] = [
  {
    key: 'kingdom-knowledge',
    slug: { en: 'kingdom-knowledge', fr: 'connaissance-du-royaume' },
    name: { en: 'Kingdom Knowledge', fr: 'Connaissance du Royaume' },
    blurb: {
      en: 'What the Kingdom of God is, and what it means to belong to it.',
      fr: 'Ce qu’est le Royaume de Dieu et ce que signifie en faire partie.',
    },
    topics: {
      en: ['The Kingdom of God', 'Kingdom principles and foundations', 'Kingdom citizenship', 'Identity in Christ', 'Rights and inheritance', 'Righteousness', 'Dominion and authority', 'The life of God within the believer'],
      fr: ['Le Royaume de Dieu', 'Principes et fondements du Royaume', 'La citoyenneté du Royaume', 'L’identité en Christ', 'Droits et héritage', 'La justice', 'La domination et l’autorité', 'La vie de Dieu dans le croyant'],
    },
    hasArticles: false,
  },
  {
    key: 'kingdom-leadership',
    slug: { en: 'kingdom-leadership', fr: 'leadership-du-royaume' },
    name: { en: 'Kingdom Leadership', fr: 'Leadership du Royaume' },
    blurb: { en: 'Leadership that serves, grows and multiplies.', fr: 'Un leadership qui sert, fait grandir et se multiplie.' },
    topics: {
      en: ['Kingdom leadership principles', 'Leadership development', 'Kingdom ambassadors', 'Spiritual maturity', 'The fivefold ministry', 'Equipping believers for ministry', 'Leadership responsibility and service'],
      fr: ['Principes de leadership du Royaume', 'Développement du leadership', 'Les ambassadeurs du Royaume', 'La maturité spirituelle', 'Le ministère quintuple', 'Équiper les croyants pour le ministère', 'Responsabilité et service dans le leadership'],
    },
    hasArticles: false,
  },
  {
    key: 'digital-media-evangelism',
    slug: { en: 'digital-media-evangelism', fr: 'medias-numeriques-et-evangelisation' },
    name: { en: 'Digital Media and Evangelism', fr: 'Médias numériques et évangélisation' },
    blurb: { en: 'Carrying the Gospel through the phones and platforms people already use.', fr: 'Porter l’Évangile par les téléphones et les plateformes que les gens utilisent déjà.' },
    topics: {
      en: ['Digital evangelism', 'Social media outreach', 'Multimedia for the Gospel', 'Christian content creation', 'Digital communication', 'Using smartphones and modern media for Kingdom advancement', 'Reaching people through online platforms'],
      fr: ['L’évangélisation numérique', 'La présence sur les réseaux sociaux', 'Le multimédia au service de l’Évangile', 'La création de contenu chrétien', 'La communication numérique', 'Utiliser les smartphones et les médias modernes pour l’avancement du Royaume', 'Atteindre les gens par les plateformes en ligne'],
    },
    hasArticles: false,
  },
  {
    key: 'discipleship-spiritual-development',
    slug: { en: 'discipleship-spiritual-development', fr: 'discipulat-et-developpement-spirituel' },
    name: { en: 'Discipleship and Spiritual Development', fr: 'Discipulat et développement spirituel' },
    blurb: { en: 'Growing in the knowledge of God and in a life that shows it.', fr: 'Grandir dans la connaissance de Dieu et dans une vie qui la reflète.' },
    topics: {
      en: ['Spiritual growth', 'Discipleship', 'Christian living', 'Prayer', 'Spiritual development', 'Growing in the knowledge of God', 'Developing effective Kingdom citizens'],
      fr: ['La croissance spirituelle', 'Le discipulat', 'La vie chrétienne', 'La prière', 'Le développement spirituel', 'Grandir dans la connaissance de Dieu', 'Former des citoyens du Royaume efficaces'],
    },
    hasArticles: false,
  },
  {
    key: 'books-publications',
    slug: { en: 'books-publications', fr: 'livres-et-publications' },
    name: { en: 'Books and Publications', fr: 'Livres et publications' },
    blurb: { en: 'The Kingdom Series and our other original publications.', fr: 'La Série du Royaume et nos autres publications originales.' },
    topics: {
      en: ['The Kingdom Series', 'Books and teaching publications', 'Book introductions and extracts', 'Authors and publication information', 'Related articles and educational resources'],
      fr: ['La Série du Royaume', 'Livres et publications d’enseignement', 'Présentations et extraits de livres', 'Auteurs et informations de publication', 'Articles et ressources éducatives associés'],
    },
    hasArticles: false,
  },
  {
    key: 'community-outreach',
    slug: { en: 'community-outreach', fr: 'communaute-et-rayonnement' },
    name: { en: 'Kingdom Community and Outreach', fr: 'Communauté du Royaume et rayonnement' },
    blurb: { en: 'Making disciples who make disciples, together.', fr: 'Faire ensemble des disciples qui font des disciples.' },
    topics: {
      en: ['Kingdom community development', 'Outreach and evangelism', 'Making disciples who make disciples', 'Mobilising Kingdom citizens', 'Prayer and community support', 'Local and international Kingdom activities'],
      fr: ['Le développement de la communauté du Royaume', 'Le rayonnement et l’évangélisation', 'Faire des disciples qui font des disciples', 'Mobiliser les citoyens du Royaume', 'La prière et le soutien communautaire', 'Les activités du Royaume, locales et internationales'],
    },
    hasArticles: false,
  },
];

/** Section words in the address, per language. */
export const SECTION: Record<Lang, { knowledge: string; about: string; contact: string; join: string; login: string; books: string }> = {
  en: { knowledge: 'knowledge', about: 'about', contact: 'contact', join: 'join', login: 'login', books: 'books' },
  fr: { knowledge: 'connaissance', about: 'a-propos', contact: 'contact', join: 'rejoindre', login: 'connexion', books: 'livres' },
};

export type PageKey = 'home' | 'knowledge' | 'division' | 'about' | 'contact' | 'article' | 'book';

/**
 * The French page is public (indexable, linked) only after the ministry approves it.
 * Approved by the founder on 3 November 2026 so that the French pages go live with the English
 * ones. This is a decision to publish, not a French-language proofreading: the founder will
 * read the French line by line (docs/FRENCH_REVIEW_SHEET.md) and send corrections, which are
 * then made here. Set a page to false to take its French version back off the public site.
 */
export const FR_APPROVAL = { by: 'Evangelist Stanley A. Ndoh', on: '2026-11-03', note: 'Approved to publish; line-by-line reading and corrections to follow.' };
export const FR_REVIEWED: Record<PageKey, boolean> = { home: true, knowledge: true, division: true, about: true, contact: true, article: true, book: true };

export const UI: Record<Lang, Record<string, string>> = {
  en: {
    siteName: 'The God Nation',
    tagline: 'Media & Leadership Academy',
    skip: 'Skip to the content',
    navKnowledge: 'Knowledge Centre',
    navAbout: 'About',
    navContact: 'Contact',
    navJoin: 'Join the community',
    navJoinShort: 'Join',
    navMembers: 'Members: Sign in',
    langSwitch: 'Lire en français',
    home: 'Home',
    heroKicker: 'Media & Leadership Academy',
    heroTitle: 'Equipping citizens of the Kingdom to carry the Gospel through modern media',
    heroCta: 'Explore the Knowledge Centre',
    heroCta2: 'About The God Nation',
    startHere: 'Start here',
    areasTitle: 'Six areas of Kingdom knowledge',
    whatTitle: 'What we do',
    ecoTitle: 'Read. Learn. Belong.',
    ecoRead: 'Read',
    ecoReadText: 'Original Kingdom teaching, published in English and French in the Knowledge Centre.',
    ecoLearn: 'Learn',
    ecoLearnText: 'Training in the Leadership School: books, teachings and examinations for registered members.',
    ecoBelong: 'Belong',
    ecoBelongText: 'A community that supports, teaches and develops its members, on the phone you already use.',
    joinTitle: 'Become part of the community',
    joinText: 'Reading is a beginning. Training and fellowship happen in the community, where you are equipped and sent to make disciples who make disciples.',
    joinCta: 'Join the community',
    joinMember: 'Already a member?',
    joinSignIn: 'Sign in',
    kcTitle: 'Knowledge Centre',
    kcIntro: 'An organised library of Kingdom knowledge in six areas, growing over the years. Articles are added as they are approved for publication.',
    divCovers: 'This area covers',
    divSoon: 'The first articles in this area are being prepared. They will appear here as soon as they are approved for publication.',
    divBack: 'All areas of the Knowledge Centre',
    aboutTitle: 'About The God Nation',
    aboutMission: 'Our purpose',
    aboutVision: 'Our vision',
    aboutWhat: 'What we do',
    aboutHow: 'How the pieces fit together',
    aboutHowText1: 'The public website introduces The God Nation and makes approved Kingdom knowledge available to everyone, without signing in.',
    aboutHowText2: 'The Knowledge Centre is where original teaching is organised, published and translated.',
    aboutHowText3: 'The community platform, on your phone, equips and develops registered members through the Leadership School, teachings, books, examinations and fellowship.',
    contactTitle: 'Contact',
    contactIntro: 'We would be glad to hear from you.',
    contactForm: 'Send us a message',
    contactFormText: 'Use the contact form in the app. We keep your message safely and reply as soon as we can.',
    contactPrivacy: 'How we handle your information',
    footerMembers: 'Members: Sign in',
    footerPrivacy: 'Privacy',
    footerTerms: 'Terms of Use',
    footerMore: 'The ministry',
    togetherTitle: 'Learning together',
    founderRole: 'Founder',
    mottoKicker: 'Our call',
    founderKicker: 'The founder',
    founderTitle: 'Meet the founder',
    founderText1: 'Evangelist Stanley A. Ndoh founded The God Nation Media and Leadership Academy to equip citizens of the Kingdom of God to carry the Gospel of the Kingdom through modern media.',
    founderText2: 'He holds a B.A. in Christian Ministry and is the author of The Kingdom Series, which begins with The Restoration of Dominion.',
    founderCta: 'Our purpose and vision',
    bookKicker: 'The Kingdom Series',
    bookShelfTitle: 'Books by Evangelist Stanley A. Ndoh',
    bookText: 'Registered members study Book One in the Leadership School, with reading offline on the phone and an examination.',
    bookBy: 'By',
    bookCta: 'Join to read it',
    bookAbout: 'About our books',
    bookMore: 'More about our books',
    bookDetails: 'About the book',
    bookChapters: 'Chapter summaries',
    bookMembers: 'The full book is read inside the community. Join, and you can start reading.',
    bookAll: 'All our books',
    rights: 'The God Nation Media & Leadership Academy',
    notFoundTitle: 'Page not found',
    notFoundText: 'This page does not exist, or is not public.',
    notFoundHome: 'Go to the home page',
    breadcrumbs: 'Breadcrumb',
    mainNav: 'Main navigation',
    languageLabel: 'Language',
    latestTitle: 'Latest from the Knowledge Centre',
    articlesIn: 'Articles in this area',
    byAuthor: 'By',
    published: 'Published',
    updated: 'Updated',
    minRead: 'min read',
    inThisArticle: 'In this article',
    faqTitle: 'Questions people ask',
    relatedTitle: 'Related articles',
    shareTitle: 'Share',
    shareWhatsapp: 'WhatsApp',
    shareFacebook: 'Facebook',
    aboutAuthor: 'About the author',
    readOther: 'Lire cet article en français',
  },
  fr: {
    siteName: 'The God Nation',
    tagline: 'Académie des médias et du leadership',
    skip: 'Aller au contenu',
    navKnowledge: 'Centre de connaissance',
    navAbout: 'À propos',
    navContact: 'Contact',
    navJoin: 'Rejoindre la communauté',
    navJoinShort: 'Rejoindre',
    navMembers: 'Membres : connexion',
    langSwitch: 'Read in English',
    home: 'Accueil',
    heroKicker: 'Académie des médias et du leadership',
    heroTitle: 'Équiper les citoyens du Royaume pour porter l’Évangile par les médias modernes',
    heroCta: 'Découvrir le Centre de connaissance',
    heroCta2: 'À propos de The God Nation',
    startHere: 'Pour commencer',
    areasTitle: 'Six domaines de la connaissance du Royaume',
    whatTitle: 'Ce que nous faisons',
    ecoTitle: 'Lire. Apprendre. Appartenir.',
    ecoRead: 'Lire',
    ecoReadText: 'Un enseignement original sur le Royaume, publié en français et en anglais dans le Centre de connaissance.',
    ecoLearn: 'Apprendre',
    ecoLearnText: 'La formation de l’École de leadership : livres, enseignements et examens pour les membres inscrits.',
    ecoBelong: 'Appartenir',
    ecoBelongText: 'Une communauté qui soutient, enseigne et fait grandir ses membres, sur le téléphone que vous utilisez déjà.',
    joinTitle: 'Rejoignez la communauté',
    joinText: 'Lire est un début. La formation et la communion se vivent dans la communauté, où vous êtes équipé et envoyé pour faire des disciples qui font des disciples.',
    joinCta: 'Rejoindre la communauté',
    joinMember: 'Déjà membre ?',
    joinSignIn: 'Se connecter',
    kcTitle: 'Centre de connaissance',
    kcIntro: 'Une bibliothèque organisée de la connaissance du Royaume, en six domaines, qui grandira au fil des années. Les articles sont ajoutés au fur et à mesure de leur approbation.',
    divCovers: 'Ce domaine couvre',
    divSoon: 'Les premiers articles de ce domaine sont en préparation. Ils apparaîtront ici dès leur approbation.',
    divBack: 'Tous les domaines du Centre de connaissance',
    aboutTitle: 'À propos de The God Nation',
    aboutMission: 'Notre raison d’être',
    aboutVision: 'Notre vision',
    aboutWhat: 'Ce que nous faisons',
    aboutHow: 'Comment tout s’articule',
    aboutHowText1: 'Le site public présente The God Nation et met la connaissance approuvée du Royaume à la disposition de tous, sans avoir à se connecter.',
    aboutHowText2: 'Le Centre de connaissance est le lieu où l’enseignement original est organisé, publié et traduit.',
    aboutHowText3: 'La plateforme communautaire, sur votre téléphone, équipe et fait grandir les membres inscrits par l’École de leadership, les enseignements, les livres, les examens et la communion fraternelle.',
    contactTitle: 'Contact',
    contactIntro: 'Nous serons heureux de vous lire.',
    contactForm: 'Envoyez-nous un message',
    contactFormText: 'Utilisez le formulaire de contact de l’application. Nous conservons votre message en sécurité et répondons dès que possible.',
    contactPrivacy: 'Comment nous traitons vos informations',
    footerMembers: 'Membres : connexion',
    footerPrivacy: 'Confidentialité',
    footerTerms: 'Conditions d’utilisation',
    footerMore: 'Le ministère',
    togetherTitle: 'Apprendre ensemble',
    founderRole: 'Fondateur',
    mottoKicker: 'Notre appel',
    founderKicker: 'Le fondateur',
    founderTitle: 'Faites connaissance avec le fondateur',
    founderText1: 'L’évangéliste Stanley A. Ndoh a fondé The God Nation Media and Leadership Academy pour équiper les citoyens du Royaume de Dieu afin qu’ils portent l’Évangile du Royaume par les médias modernes.',
    founderText2: 'Titulaire d’une licence en ministère chrétien, il est l’auteur de La Série du Royaume, qui commence par The Restoration of Dominion.',
    founderCta: 'Notre raison d’être et notre vision',
    bookKicker: 'La Série du Royaume',
    bookShelfTitle: 'Livres de l’évangéliste Stanley A. Ndoh',
    bookText: 'Les membres inscrits étudient le Livre un dans l’École de leadership, avec lecture hors connexion sur le téléphone et examen.',
    bookBy: 'Par',
    bookCta: 'Rejoindre pour le lire',
    bookAbout: 'À propos de nos livres',
    bookMore: 'En savoir plus sur nos livres',
    bookDetails: 'À propos du livre',
    bookChapters: 'Résumés des chapitres',
    bookMembers: 'Le livre complet se lit au sein de la communauté. Rejoignez-nous, et vous pourrez commencer à lire.',
    bookAll: 'Tous nos livres',
    rights: 'The God Nation Media & Leadership Academy',
    notFoundTitle: 'Page introuvable',
    notFoundText: 'Cette page n’existe pas, ou n’est pas publique.',
    notFoundHome: 'Aller à la page d’accueil',
    breadcrumbs: 'Fil d’Ariane',
    mainNav: 'Navigation principale',
    languageLabel: 'Langue',
    latestTitle: 'Dernières publications du Centre de connaissance',
    articlesIn: 'Articles de ce domaine',
    byAuthor: 'Par',
    published: 'Publié le',
    updated: 'Mis à jour le',
    minRead: 'min de lecture',
    inThisArticle: 'Dans cet article',
    faqTitle: 'Questions fréquentes',
    relatedTitle: 'Articles associés',
    shareTitle: 'Partager',
    shareWhatsapp: 'WhatsApp',
    shareFacebook: 'Facebook',
    aboutAuthor: 'À propos de l’auteur',
    readOther: 'Read this article in English',
  },
};

export const PAGE_META: Record<Lang, Record<PageKey, { title: string; description: string }>> = {
  en: {
    home: { title: 'The God Nation — Media & Leadership Academy', description: MISSION.en },
    knowledge: { title: 'Knowledge Centre — The God Nation', description: 'An organised library of Kingdom knowledge in six areas: Kingdom knowledge, leadership, digital media and evangelism, discipleship, books and publications, and community and outreach.' },
    division: { title: '', description: '' },
    article: { title: '', description: '' },
    book: { title: '', description: '' },
    about: { title: 'About The God Nation', description: 'Who we are, our calling, our vision and our mission: gathering and equipping citizens of the Kingdom to carry the Gospel through modern media.' },
    contact: { title: 'Contact — The God Nation', description: 'How to contact The God Nation.' },
  },
  fr: {
    home: { title: 'The God Nation — Académie des médias et du leadership', description: MISSION.fr },
    knowledge: { title: 'Centre de connaissance — The God Nation', description: 'Une bibliothèque organisée de la connaissance du Royaume en six domaines : connaissance du Royaume, leadership, médias numériques et évangélisation, discipulat, livres et publications, communauté et rayonnement.' },
    division: { title: '', description: '' },
    article: { title: '', description: '' },
    book: { title: '', description: '' },
    about: { title: 'À propos de The God Nation', description: 'Qui nous sommes, notre appel, notre vision et notre mission : rassembler et équiper les citoyens du Royaume pour porter l’Évangile par les médias modernes.' },
    contact: { title: 'Contact — The God Nation', description: 'Comment contacter The God Nation.' },
  },
};

/**
 * Photographs for the public pages. Empty until real photos are supplied; a page shows a photo
 * only when one is set here (with a description for people who cannot see it, in both
 * languages). Files live in client/public/site/ and are served at /site/<file>.
 * Example: founder: { src: '/site/founder.jpg', w: 760, h: 1013, alt: { en: 'Evangelist Stanley A. Ndoh', fr: 'L\'évangéliste Stanley A. Ndoh' } }
 */
export interface SitePhoto { src: string; w: number; h: number; alt: Record<Lang, string>; caption?: Record<Lang, string> }
export const PHOTOS: { founder?: SitePhoto; founderOffice?: SitePhoto; group?: SitePhoto; groupClose?: SitePhoto; sessionMore?: SitePhoto[] } = {
  group: { src: '/site/session-room.jpg', w: 1000, h: 750, alt: { en: 'People seated around tables during a teaching and training session', fr: 'Des personnes assises autour de tables pendant une session d’enseignement et de formation' }, caption: { en: 'People gathered for a teaching and training session.', fr: 'Des participants réunis pour une session d’enseignement et de formation.' } },
  sessionMore: [
    { src: '/site/session-presenter.jpg', w: 900, h: 405, alt: { en: 'A facilitator presenting to participants seated at long tables', fr: 'Une animatrice s’adresse aux participants assis autour de longues tables' } },
    { src: '/site/session-workshop.jpg', w: 700, h: 933, alt: { en: 'A facilitator addressing participants during a training workshop', fr: 'Une animatrice s’adresse aux participants pendant un atelier de formation' } },
  ],
  groupClose: { src: '/site/session-close.jpg', w: 700, h: 933, alt: { en: 'Participants listening and taking notes during a training session', fr: 'Des participants écoutent et prennent des notes pendant une session de formation' } },
  founder: { src: '/site/founder.jpg', w: 760, h: 1013, alt: { en: 'Evangelist Stanley A. Ndoh, founder of The God Nation Media and Leadership Academy', fr: 'L’évangéliste Stanley A. Ndoh, fondateur de The God Nation Media and Leadership Academy' } },
  founderOffice: { src: '/site/founder-office.jpg', w: 760, h: 1013, alt: { en: 'Evangelist Stanley A. Ndoh in his office', fr: 'L’évangéliste Stanley A. Ndoh dans son bureau' } },
};
