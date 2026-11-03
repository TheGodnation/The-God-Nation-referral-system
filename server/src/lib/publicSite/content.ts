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

export const WHAT_WE_DO: Record<Lang, string[]> = {
  en: ['Kingdom education', 'Kingdom citizenship and identity', 'Christian leadership development', 'Spiritual growth and discipleship', 'Books and educational publications', 'Digital media and evangelism', 'Equipping believers to become effective ambassadors of the Kingdom', 'Building a community that supports, teaches and develops its members'],
  fr: ['L’éducation du Royaume', 'La citoyenneté et l’identité du Royaume', 'Le développement du leadership chrétien', 'La croissance spirituelle et le discipulat', 'Les livres et publications éducatives', 'Les médias numériques et l’évangélisation', 'Équiper les croyants pour qu’ils deviennent des ambassadeurs efficaces du Royaume', 'Bâtir une communauté qui soutient, enseigne et fait grandir ses membres'],
};

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
export const SECTION: Record<Lang, { knowledge: string; about: string; contact: string; join: string; login: string }> = {
  en: { knowledge: 'knowledge', about: 'about', contact: 'contact', join: 'join', login: 'login' },
  fr: { knowledge: 'connaissance', about: 'a-propos', contact: 'contact', join: 'rejoindre', login: 'connexion' },
};

export type PageKey = 'home' | 'knowledge' | 'division' | 'about' | 'contact' | 'article';

/**
 * The French page is public (indexable, linked) only after the ministry approves it.
 * Approved by the founder on 3 November 2026 so that the French pages go live with the English
 * ones. This is a decision to publish, not a French-language proofreading: the founder will
 * read the French line by line (docs/FRENCH_REVIEW_SHEET.md) and send corrections, which are
 * then made here. Set a page to false to take its French version back off the public site.
 */
export const FR_APPROVAL = { by: 'Evangelist Stanley A. Ndoh', on: '2026-11-03', note: 'Approved to publish; line-by-line reading and corrections to follow.' };
export const FR_REVIEWED: Record<PageKey, boolean> = { home: true, knowledge: true, division: true, about: true, contact: true, article: true };

export const UI: Record<Lang, Record<string, string>> = {
  en: {
    siteName: 'The God Nation',
    tagline: 'Media & Leadership Academy',
    skip: 'Skip to the content',
    navKnowledge: 'Knowledge Centre',
    navAbout: 'About',
    navContact: 'Contact',
    navJoin: 'Join the community',
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
    footerMore: 'The ministry',
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
    footerMore: 'Le ministère',
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
    about: { title: 'About The God Nation', description: 'Our purpose, our vision and what The God Nation Media and Leadership Academy does.' },
    contact: { title: 'Contact — The God Nation', description: 'How to contact The God Nation.' },
  },
  fr: {
    home: { title: 'The God Nation — Académie des médias et du leadership', description: MISSION.fr },
    knowledge: { title: 'Centre de connaissance — The God Nation', description: 'Une bibliothèque organisée de la connaissance du Royaume en six domaines : connaissance du Royaume, leadership, médias numériques et évangélisation, discipulat, livres et publications, communauté et rayonnement.' },
    division: { title: '', description: '' },
    article: { title: '', description: '' },
    about: { title: 'À propos de The God Nation', description: 'Notre raison d’être, notre vision et ce que fait The God Nation Media and Leadership Academy.' },
    contact: { title: 'Contact — The God Nation', description: 'Comment contacter The God Nation.' },
  },
};

/**
 * Photographs for the public pages. Empty until real photos are supplied; a page shows a photo
 * only when one is set here (with a description for people who cannot see it, in both
 * languages). Files live in client/public/site/ and are served at /site/<file>.
 * Example: founder: { src: '/site/founder.jpg', alt: { en: 'Evangelist Stanley A. Ndoh', fr: 'L\'évangéliste Stanley A. Ndoh' } }
 */
export interface SitePhoto { src: string; alt: Record<Lang, string>; caption?: Record<Lang, string> }
export const PHOTOS: { founder?: SitePhoto; group?: SitePhoto } = {};
