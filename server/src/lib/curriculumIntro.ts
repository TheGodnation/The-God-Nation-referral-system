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
- *Institution:* The God Nation Media & Leadership Academy
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
The God Nation Media & Leadership Academy exists to raise Kingdom leaders who carry the Gospel of the Kingdom through modern media and on the ground.

A person who speaks for the Kingdom must first know the Kingdom, understand who they are in Christ, and learn to live what they teach.

This diploma provides that spiritual foundation.

The development pathway has two phases:

## Phase 1: Spiritual Training — This Diploma
Students study the {{books}} books, complete {{books}} examinations, and receive the diploma certificate after meeting the graduation requirements.

## Phase 2: Leadership and Technical Development
Graduates can join the leadership team. As they work together with the team, they receive gradual technical training that develops their ability to serve effectively through modern media and on the ground.

This second phase helps graduates develop practical ministry and leadership skills, including teaching, discipleship, following up new believers, building Kingdom communities, and using digital platforms to communicate the Gospel.

The objective is not simply to produce people who have read books, but Kingdom Citizens who can live the message, teach others, and participate in advancing the Kingdom.

## The Academy's Vision
A multiplying generation of Kingdom Citizens and ambassadors who win souls through mass media and on the ground, until cities, towns, and villages are saturated with the Gospel of the Kingdom.

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

Modern media and technical skills are developed further in Phase 2. They are not presented as subjects taught and examined throughout the {{books}} books.

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

The God Nation Media & Leadership Academy will then issue the certificate titled *DIPLOMA IN KINGDOM STUDIES AND DOMINION LEADERSHIP*.

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

export const DEFAULT_INTRO_FR = `# Le diplôme en un coup d’œil
Dieu a fait l’homme à Son image pour régner sur la terre sous Son autorité. L’homme a perdu cette place par la chute, et Jésus-Christ l’a rétablie. Pourtant, de nombreux croyants vivent encore dans la peur, le manque et la confusion, parce qu’on ne leur a pas suffisamment enseigné ce que Dieu leur a déjà donné en Christ.

Ce diplôme est conçu pour changer cela.

Il conduit les étudiants à travers la restauration de la domination, la porte d’entrée du Royaume, les Clés qui gouvernent la vie du Royaume et les droits que Christ a déjà donnés à Ses citoyens.

C’est un programme de formation spirituelle structuré qui aide les croyants à comprendre le Royaume, à découvrir leur identité et leur héritage en Christ, à grandir en maturité spirituelle et à être équipés pour communiquer l’Évangile du Royaume aux autres.

## Informations sur le programme
- *Qualification :* Diplôme en études du Royaume et leadership de domination
- *Institution :* The God Nation Media & Leadership Academy
- *Auteur et fondateur :* Évangéliste Stanley A. Ndoh
- *Qui peut s’inscrire :* Toute personne qui désire connaître Jésus-Christ plus profondément, comprendre le Royaume de Dieu, grandir spirituellement ou apprendre à partager l’Évangile avec les autres.
@web - *Frais du programme :* Il n’y a pas de frais généraux de programme. Les étudiants paient {{price}} FCFA par livre et passent l’examen de chaque livre.
- *Méthode d’étude :* En ligne, sur la plateforme de l’Académie. Les étudiants peuvent lire leurs livres directement sur la plateforme ou les télécharger sur leur téléphone.
- *Rythme :* À votre rythme. Certains étudiants peuvent terminer un livre en trois jours environ, d’autres en quatre, cinq, six jours ou plus.
- *Examens :* Examens en ligne à choix multiples.
- *Note de passage :* 70 %.
- *Contenu du programme :* {{books}} livres répartis en {{levels}} niveaux progressifs.
- *Récompense :* Un certificat intitulé _Diplôme en études du Royaume et leadership de domination_ à la réussite du programme.

Vous n’avez pas besoin d’être pasteur, prédicateur, théologien ou leader expérimenté pour vous inscrire. Le programme est ouvert aux croyants ordinaires et à toute personne qui veut comprendre le Royaume et grandir dans sa relation avec Dieu.

# Pourquoi étudier ce diplôme ?
Beaucoup de croyants aiment Dieu, vont à l’église et lisent la Bible, mais n’ont jamais reçu d’enseignement systématique sur leur identité, leurs droits, leur autorité et leurs responsabilités en Christ.

Certains connaissent des versets bibliques mais ne comprennent pas pleinement comment fonctionne le Royaume ni comment en communiquer le message aux autres.

Ce diplôme propose un parcours progressif à travers {{books}} livres. Il va des fondements du Royaume aux principes pratiques de la vie du Royaume, puis aux droits et à l’autorité qui appartiennent aux croyants en Christ.

Les étudiants ne reçoivent pas simplement une collection de livres. Ils étudient chaque livre, passent un examen et montrent leur compréhension avant de continuer.

À la fin du programme, les étudiants devraient avoir une meilleure compréhension du Royaume, une conscience plus claire de qui ils sont en Christ et une meilleure base pour vivre et communiquer l’Évangile du Royaume.

# Raison d’être et parcours
The God Nation Media & Leadership Academy existe pour former des leaders du Royaume qui portent l’Évangile du Royaume à travers les médias modernes et sur le terrain.

Une personne qui parle pour le Royaume doit d’abord connaître le Royaume, comprendre qui elle est en Christ et apprendre à vivre ce qu’elle enseigne.

Ce diplôme apporte ce fondement spirituel.

Le parcours de développement comprend deux phases :

## Phase 1 : Formation spirituelle — ce diplôme
Les étudiants étudient les {{books}} livres, passent {{books}} examens et reçoivent le certificat du diplôme après avoir rempli les conditions de fin d’études.

## Phase 2 : Développement du leadership et des compétences techniques
Les diplômés peuvent rejoindre l’équipe de leadership. En travaillant avec l’équipe, ils reçoivent progressivement une formation technique qui développe leur capacité à servir efficacement à travers les médias modernes et sur le terrain.

Cette deuxième phase aide les diplômés à développer des compétences pratiques de ministère et de leadership, notamment l’enseignement, le discipulat, le suivi des nouveaux croyants, la construction de communautés du Royaume et l’utilisation des plateformes numériques pour communiquer l’Évangile.

L’objectif n’est pas seulement de former des personnes qui ont lu des livres, mais des Citoyens du Royaume qui peuvent vivre le message, l’enseigner aux autres et participer à l’avancement du Royaume.

## La vision de l’Académie
Une génération multiplicatrice de Citoyens et d’ambassadeurs du Royaume qui gagnent des âmes par les médias de masse et sur le terrain, jusqu’à ce que les villes, les villages et les hameaux soient saturés de l’Évangile du Royaume.

## La mission de l’Académie
Éveiller, former et envoyer des croyants qui marchent dans leurs droits, leur identité, leur autorité et leur domination de Citoyens du Royaume.

# Les livres, niveau par niveau
Le programme est organisé en niveaux. Chaque niveau s’appuie sur les connaissances acquises dans le précédent. Les livres s’ouvrent un par un, dans l’ordre.

[[books]]

# Ce qu’un diplômé peut faire
Après avoir terminé le programme avec succès, les diplômés devraient être équipés pour :
- Expliquer le Royaume des cieux et le Royaume de Dieu.
- Expliquer les fondements de la citoyenneté du Royaume et comment une personne y entre.
- Comprendre et appliquer les Clés du Royaume dans leur vie.
- Comprendre leur identité, leur héritage, leurs droits et leur autorité en Christ.
- Développer la maturité spirituelle, le caractère et une compréhension plus profonde de la vie du Royaume.
- Enseigner aux autres le Royaume de Dieu et communiquer l’Évangile sur le terrain.
- Amener des personnes dans le Royaume et les aider à s’y établir selon ses principes.
- Développer les fondements du leadership, du discipulat et de l’expansion du Royaume.

Les médias modernes et les compétences techniques sont développés davantage dans la phase 2. Ils ne sont pas présentés comme des matières enseignées et examinées tout au long des {{books}} livres.

# Comment vous étudiez
Le programme est dispensé sur la plateforme en ligne de l’Académie. Les étudiants ne reçoivent pas tous les livres en même temps. Chaque livre s’ouvre après que l’étudiant a réussi le livre précédent et son examen.

1. *S’inscrire.* L’étudiant s’inscrit au programme et accède à son tableau de bord personnel.
2. *Le premier livre s’ouvre.* Le Livre 1 devient disponible. Les autres livres restent verrouillés.
3. *Lire le livre.* L’étudiant le lit directement sur la plateforme, où sa progression peut être suivie, ou le télécharge sur son téléphone pour le lire plus facilement. Chaque étudiant étudie à son rythme.
4. *Passer l’examen.* Une fois le livre terminé, l’examen devient disponible sur la plateforme. C’est un examen à choix multiples passé en ligne.
5. *Atteindre la note de passage.* La note de passage requise est de 70 %.
6. *Passer au livre suivant ou réessayer.* Un étudiant qui obtient 70 % ou plus débloque automatiquement le livre suivant. Un étudiant qui obtient moins de 70 % étudie de nouveau la matière et repasse l’examen ; chaque nouvel examen présente des questions différentes. Le livre suivant reste verrouillé tant que la note de passage n’est pas atteinte.
7. *Répéter le processus.* L’étudiant suit le même processus à travers les {{books}} livres, dans l’ordre prescrit.
8. *Terminer le programme.* Après avoir réussi le dernier examen et rempli les exigences finales de l’Académie, l’étudiant est admis à la remise du diplôme.

@web Le prix de chaque livre est de {{price}} FCFA.

Ce système garantit que les étudiants ne se contentent pas de collectionner des livres. Ils étudient chaque livre, montrent leur compréhension et posent un fondement avant de passer à l’étape suivante.

## Étudiez à votre rythme
Il n’y a pas de nombre de jours fixe dans lequel chaque étudiant doit terminer le diplôme. Certains avancent vite, d’autres ont besoin de plus de temps.

Vous pouvez étudier en fonction de votre travail, de votre entreprise, de votre famille et de vos autres responsabilités. Vous pouvez lire en ligne ou télécharger vos livres sur votre téléphone et continuer à étudier à votre convenance.

L’important est de terminer chaque livre et de réussir son examen avant d’avancer.

# Remise du diplôme et certificat
Un étudiant est admis à la remise du diplôme après avoir :
- Terminé les {{books}} livres.
- Réussi les {{books}} examens avec au moins 70 % à chacun.
- Terminé les livres dans l’ordre prescrit.
- Rempli toute exigence finale supplémentaire établie par l’Académie.

The God Nation Media & Leadership Academy délivrera alors le certificat intitulé *DIPLÔME EN ÉTUDES DU ROYAUME ET LEADERSHIP DE DOMINATION*.

Les diplômés auront suivi un cursus structuré sur les fondements du Royaume, les Clés du Royaume et les Droits des Citoyens du Royaume. Ils seront équipés et préparés pour :
- Enseigner dans l’église.
- Enseigner aux autres le Royaume de Dieu.
- Partager l’Évangile et amener des personnes dans le Royaume.
- Édifier les croyants pour qu’ils comprennent et vivent selon les principes du Royaume.
- Participer au discipulat et à l’expansion du Royaume.

Les diplômés peuvent aussi passer à la phase 2 en rejoignant l’équipe de leadership, où ils recevront progressivement une formation technique et pratique en travaillant avec l’équipe.

# Votre parcours commence ici
{{books}} livres. {{books}} examens. {{levels}} niveaux progressifs. Un seul parcours de découverte, de croissance et de préparation au service du Royaume.

*Sachez qui vous êtes. Sachez ce qui est à vous. Régnez sur votre vie sous Christ. Portez l’Évangile du Royaume aux nations.*`;

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
