import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// The introduction at the top of the Leadership Academy page: the diploma programme, written by the founder. The admin
// can edit it (Admin → Library → Arrange the curriculum); until then the standard text below is shown. It is written with
// the app's light formatting (*bold*, _italic_, # headings, - bullets, 1. numbers) and understands a few small markers:
//
//   [[books]]        on its own line: where the levels and their books are shown (if missing, they come after the text)
//   @web …           a line that starts with this is shown on the website only, never in the Google Play version
//                    (used for the price; the Play version shows no prices)
//   {{books}}        the number of books now in the curriculum        {{levels}}  the number of levels
//   {{price}}        the price of a book, in FCFA
//
// Because the books are listed from the arrangement itself (never typed into this text), moving a book to another level or
// adding one in between never makes this text out of date.
// ---------------------------------------------------------------------------

export const DEFAULT_INTRO_EN = `# The Diploma at a Glance
God made man in His image to rule the earth under Him. Man lost that place through the fall, and Jesus Christ restored it. Yet many believers still live under fear, lack, and confusion because they have not been adequately taught what God has already given them in Christ.

This diploma is designed to change that.

It takes students through the restoration of dominion, the doorway into the Kingdom, the Keys that govern Kingdom living, and the rights Christ has already given to His citizens.

It is a structured spiritual training programme that helps believers understand the Kingdom, discover their identity and inheritance in Christ, grow in spiritual maturity, and become equipped to communicate the Gospel of the Kingdom to others.

## Programme information
- *Qualification:* Diploma in Kingdom Studies and Dominion Leadership
- *Institution:* The God Nation Leadership Academy
- *Author and Founder:* Evangelist Stanley A. Ndoh
- *Who can join:* Anyone who desires to know Jesus Christ more deeply, understand the Kingdom of God, grow spiritually, or learn how to share the Gospel with others.
@web - *Programme fee:* There is no general programme fee. Students pay {{price}} FCFA per book and take the examination for each book.
- *Study method:* Online through the Academy platform. Students can read their books directly on the platform or download them to their phones.
- *Learning pace:* Self-paced. Some students may complete a book in about three days, while others may take four, five, six days, or longer.
- *Examinations:* Online multiple-choice examinations.
- *Pass mark:* 70%.
- *Programme content:* {{books}} books organised into {{levels}} progressive levels.
- *Award:* A certificate titled _Diploma in Kingdom Studies and Dominion Leadership_ upon successful completion of the programme.

You do not need to be a pastor, preacher, theologian, or experienced leader to join. The programme is open to ordinary believers and anyone who wants to understand the Kingdom and grow in their relationship with God.

# Why Study This Diploma?
Many believers love God, attend church, and read the Bible, but have never been systematically taught about their identity, rights, authority, and responsibilities in Christ.

Some know Bible verses but do not fully understand how the Kingdom operates or how to communicate its message to others.

This diploma offers a progressive journey through {{books}} books. It moves from the foundations of the Kingdom to the practical principles of Kingdom living, and finally to the rights and authority that belong to believers in Christ.

Students do not simply receive a collection of books. They study each book, take an examination, and demonstrate their understanding before proceeding.

By the end of the programme, students should have a stronger understanding of the Kingdom, a clearer awareness of who they are in Christ, and a better foundation for living and communicating the Gospel of the Kingdom.

# Purpose and Pathway
The God Nation Leadership Academy exists to raise Kingdom leaders who carry the Gospel of the Kingdom to others.

A person who speaks for the Kingdom must first know the Kingdom, understand who they are in Christ, and learn to live what they teach.

This diploma provides that spiritual foundation.

The development pathway has two phases:

## Phase 1: Spiritual Training — This Diploma
Students study the {{books}} books, complete {{books}} examinations, and receive the diploma certificate after meeting the graduation requirements.

## Phase 2: Leadership and Technical Development
Graduates can join the leadership team. As they work together with the team, they receive gradual technical training that develops their ability to serve effectively in the field.

This second phase helps graduates develop practical ministry and leadership skills, including teaching, discipleship, following up new believers, and building Kingdom communities.

The objective is not simply to produce people who have read books, but Kingdom Citizens who can live the message, teach others, and participate in advancing the Kingdom.

## The Academy's Vision
A multiplying generation of Kingdom Citizens and ambassadors who win souls on the ground, until cities, towns, and villages are saturated with the Gospel of the Kingdom.

## The Academy's Mission
To awaken, train, and send believers who walk in their rights, identity, authority, and dominion as Kingdom Citizens.

# The Books, Level by Level
The programme is arranged in levels. Each level builds on the knowledge acquired in the previous one. The books are opened one at a time, in order.

[[books]]

# What a Graduate Can Do
After successfully completing the programme, graduates should be equipped to:
- Explain the Kingdom of Heaven and the Kingdom of God.
- Explain the foundations of Kingdom citizenship and how a person enters the Kingdom.
- Understand and apply the Kingdom Keys in their lives.
- Understand their identity, inheritance, rights, and authority in Christ.
- Develop spiritual maturity, character, and a deeper understanding of Kingdom living.
- Teach others about the Kingdom of God and communicate the Gospel on the ground.
- Bring people into the Kingdom and help establish them in its principles.
- Develop the foundations of leadership, discipleship, and Kingdom expansion.

Technical skills are developed further in Phase 2. They are not presented as subjects taught and examined throughout the {{books}} books.

# How You Study
The programme is delivered through the Academy's online platform. Students do not receive all the books at once. Instead, each book is unlocked after the student successfully completes the previous book and its examination.

1. *Register.* The student registers for the programme and receives access to a personal dashboard.
2. *The first book opens.* Book 1 becomes available. The remaining books stay locked.
3. *Read the book.* The student reads it directly on the platform, where reading progress can be seen, or downloads it to their phone for convenient reading. Each student studies at their own pace.
4. *Take the examination.* After completing the book, the examination becomes available on the platform. It is a multiple-choice examination taken online.
5. *Achieve the pass mark.* The required pass mark is 70%.
6. *Progress to the next book or try again.* A student who scores 70% or above automatically unlocks the next book. A student who scores below 70% studies the material again and repeats the examination; each repeat presents different questions. The next book stays locked until the required pass mark is achieved.
7. *Repeat the process.* The student follows the same process through all {{books}} books, in the prescribed order.
8. *Complete the programme.* After passing the final examination and meeting the Academy's final requirements, the student qualifies for graduation.

@web The price of each book is {{price}} FCFA.

This system ensures that students do not simply collect books. They study each book, demonstrate their understanding, and establish a foundation before moving to the next stage.

## Learn at your own pace
There is no fixed number of days within which every student must complete the diploma. Some students may move quickly, while others may need more time.

You can study around your work, business, family, and other responsibilities. You can read online or download your books to your phone and continue studying at your convenience.

The important thing is to complete each book and pass its examination before moving forward.

# Graduation and Certificate
A student qualifies for graduation after:
- Completing all {{books}} books.
- Passing all {{books}} examinations with at least 70% in each.
- Completing the books in the prescribed order.
- Meeting any additional final requirements established by the Academy.

The God Nation Leadership Academy will then issue the certificate titled *DIPLOMA IN KINGDOM STUDIES AND DOMINION LEADERSHIP*.

Graduates will have completed a structured course of study in Kingdom foundations, the Kingdom Keys, and the Rights of Kingdom Citizens. They will be equipped and prepared to:
- Teach in the church.
- Teach others about the Kingdom of God.
- Share the Gospel and bring people into the Kingdom.
- Build up believers to understand and live according to Kingdom principles.
- Participate in discipleship and the expansion of the Kingdom.

Graduates may also proceed to Phase 2 by joining the leadership team, where they will receive gradual technical and practical training as they work together with the team.

# Your Journey Begins Here
{{books}} books. {{books}} examinations. {{levels}} progressive levels. One journey of discovery, growth, and preparation for Kingdom service.

*Know Who You Are. Know What Is Yours. Rule Your Life Under Christ. Carry the Gospel of the Kingdom to the Nations.*`;

export const DEFAULT_INTRO_FR = `# Présentation du diplôme
Le *Diplôme en études du Royaume et en leadership dans l’exercice de la domination* est un programme de formation biblique et spirituelle conçu pour aider les croyants à comprendre le Royaume de Dieu, à découvrir leur identité et leurs droits en Christ, et à apprendre à vivre selon les principes du Royaume.

À travers {{books}} livres répartis en {{levels}} niveaux progressifs, les étudiants acquièrent une compréhension fondamentale du Royaume, des principes spirituels qui gouvernent la vie du citoyen du Royaume, ainsi que de son identité, de ses droits, de son héritage et de son autorité en Christ.

- *Institution :* The God Nation Leadership Academy
- *Diplôme délivré :* Diplôme en études du Royaume et en leadership dans l’exercice de la domination
- *Auteur et fondateur :* Évangéliste Stanley A. Ndoh
- *Nombre de livres :* {{books}}
- *Nombre d’examens :* {{books}}
@web - *Frais :* {{price}} FCFA par livre, avec son examen correspondant.

# Pourquoi suivre ce programme ?
Beaucoup de croyants connaissent certaines vérités bibliques sans nécessairement comprendre pleinement leur identité, leurs droits et leurs responsabilités en tant que citoyens du Royaume de Dieu.

Ce programme a été conçu pour leur permettre de découvrir :
- La nature du Royaume de Dieu et du Royaume des Cieux.
- Le dessein originel de Dieu pour l’homme et la restauration de la domination.
- La signification de la nouvelle naissance et de la citoyenneté du Royaume.
- Les principes spirituels qui permettent de vivre et de fonctionner dans le Royaume.
- Les droits, l’héritage et les privilèges que Dieu a accordés aux croyants en Christ.
- L’autorité et les responsabilités du citoyen du Royaume.
- Comment vivre selon les réalités du Royaume et transmettre l’Évangile du Royaume à d’autres personnes.

Ce programme n’est pas réservé aux pasteurs, aux prédicateurs, aux théologiens ou aux responsables d’Église. Il est ouvert à toute personne qui désire mieux connaître Jésus-Christ, comprendre le Royaume de Dieu et grandir spirituellement.

# Objectif et parcours de formation
Le programme est organisé en {{levels}} niveaux qui conduisent progressivement l’étudiant de la compréhension des fondements du Royaume à la découverte des principes spirituels, puis à la connaissance approfondie de ses droits en tant que citoyen du Royaume.

[[books]]

# Ce qu’un diplômé sera en mesure de faire
À l’issue de cette formation, le diplômé aura acquis une compréhension fondamentale :
- Du Royaume de Dieu et de ses principes.
- De son identité et de ses droits en tant que citoyen du Royaume.
- De son autorité, de son héritage et de ses responsabilités en Christ.
- Des principes spirituels nécessaires à une vie chrétienne fondée sur la Parole de Dieu.
- De l’importance de partager l’Évangile du Royaume et d’aider d’autres personnes à grandir dans la foi.

Il sera ainsi mieux préparé à vivre les réalités du Royaume, à enseigner les vérités bibliques qu’il a étudiées, à accompagner d’autres croyants dans leur croissance spirituelle et à communiquer l’Évangile du Royaume.

# Comment se déroule la formation ?
La formation se déroule en ligne à travers la plateforme numérique de The God Nation. Chaque étudiant dispose d’un compte personnel et d’un tableau de bord qui lui permettent d’accéder à ses livres, de suivre sa progression et de passer ses examens.

1. *Inscription :* l’étudiant crée son compte et accède à son espace personnel.
2. *Accès au premier livre :* le Livre 1 est disponible en premier. Les autres livres restent verrouillés jusqu’à ce que les conditions de progression soient remplies.
@web 3. *Paiement :* chaque livre est accessible au coût de {{price}} FCFA, examen compris.
4. *Lecture :* l’étudiant peut lire son livre directement en ligne ou le télécharger sur son téléphone pour le consulter ultérieurement.
5. *Examen :* après avoir terminé l’étude du livre, l’examen correspondant devient accessible.
6. *Validation :* l’étudiant doit obtenir une note minimale de 70 % pour réussir l’examen.
7. *Déverrouillage :* après la réussite de l’examen, le livre suivant est automatiquement débloqué.

L’étudiant avance à son propre rythme. Certains peuvent prendre environ trois jours pour étudier un livre, tandis que d’autres peuvent avoir besoin de quatre, cinq, six jours ou davantage. Il n’existe donc pas de durée globale fixe imposée pour terminer le programme.

## Règles relatives aux examens
Chaque livre est accompagné d’un examen en ligne.
- La note minimale de réussite est de 70 %.
- Chaque reprise présente des questions différentes.
- Si l’étudiant obtient moins de 70 %, il doit revoir son enseignement et repasser l’examen.
- Le livre suivant reste verrouillé tant que l’examen en cours n’est pas réussi.

Ce système permet de s’assurer que chaque étudiant progresse avec une compréhension suffisante des enseignements avant de passer au livre suivant.

# Obtention du diplôme et certification
Pour obtenir le Diplôme en études du Royaume et en leadership dans l’exercice de la domination, l’étudiant doit :
- Étudier les {{books}} livres du programme.
- Passer les {{books}} examens correspondants.
- Obtenir au moins 70 % à chacun des examens.

Après avoir satisfait à ces conditions, l’étudiant sera reconnu comme ayant achevé avec succès le programme et recevra son diplôme délivré par The God Nation Leadership Academy. Le diplôme attestera de l’achèvement du programme de formation et de la réussite des évaluations prévues par l’Académie.

# Après l’obtention du diplôme : une nouvelle étape
L’obtention du diplôme constitue la première grande étape du parcours de formation. Les diplômés qui souhaitent poursuivre leur engagement pourront être invités à rejoindre progressivement les équipes de leadership de The God Nation.

Cette deuxième phase pourra inclure une formation technique et pratique dans des domaines tels que :
- Le discipulat et l’accompagnement d’autres croyants.
- La participation aux activités d’évangélisation sur le terrain.
- Le travail en équipe et le développement du leadership au service du Royaume.

Cette formation technique et pratique constitue une étape distincte du programme académique de {{books}} livres.

# La vision et la mission de l’Académie
## La vision de l’Académie
« Une génération grandissante et multiplicatrice de citoyens du Royaume et d’ambassadeurs qui gagnent des âmes sur le terrain, jusqu’à ce que les villes, les communes et les villages soient saturés par l’Évangile du Royaume. »

## La mission de l’Académie
« Réveiller, former et envoyer des croyants qui marchent dans leurs droits, leur identité, leur autorité et leur domination en tant que citoyens du Royaume. »

# Conclusion
Le Royaume de Dieu n’est pas simplement un sujet à étudier. C’est une réalité à comprendre, une vie à manifester et un message à porter aux nations.

À travers ce programme, The God Nation Leadership Academy souhaite former des citoyens du Royaume qui connaissent leur identité, comprennent leurs droits en Christ, vivent selon les principes du Royaume et sont prêts à transmettre l’Évangile du Royaume à d’autres personnes.

*Connais qui tu es. Connais ce qui t’appartient. Règne sur ta vie sous l’autorité de Christ. Porte l’Évangile du Royaume jusqu’aux nations.*`;

export interface CurriculumIntro {
  en: string;
  fr: string;
  /** Whether the admin has written their own (false = the standard text is shown). */
  customEn: boolean;
  customFr: boolean;
}

/** The introduction to show: the admin's own text where there is one, else the standard text. */
export async function getCurriculumIntro(): Promise<CurriculumIntro> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { curriculumIntroEn: true, curriculumIntroFr: true } });
  const en = s?.curriculumIntroEn?.trim() || '';
  const fr = s?.curriculumIntroFr?.trim() || '';
  return { en: en || DEFAULT_INTRO_EN, fr: fr || DEFAULT_INTRO_FR, customEn: Boolean(en), customFr: Boolean(fr) };
}
