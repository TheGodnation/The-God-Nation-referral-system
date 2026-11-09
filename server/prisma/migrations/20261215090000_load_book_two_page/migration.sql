-- Book 2's page, English and French, written by the founder (the French was translated for him to
-- review). Loads only when the book exists and has no chapters yet, so nothing he already wrote is ever replaced;
-- a description he already wrote is kept. Later edits made in the app are never touched (this runs once).
DO $load$
DECLARE
  b_id TEXT;
BEGIN
  SELECT "id" INTO b_id FROM "LibraryBook" WHERE "kind" = 'TRAINING' AND "trainingOrder" = 2;
  IF b_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "BookChapter" WHERE "bookId" = b_id) THEN
    RETURN;
  END IF;

  UPDATE "LibraryBook"
  SET "descriptionEn" = COALESCE(NULLIF("descriptionEn", ''), $bp$_Repent. Be Baptized. Receive the Spirit._

_Book Two of the Kingdom Series_

_Evangelist Stanley A. Ndoh | The God Nation Media & Leadership Academy_

# There Is a Door. And You Were Made to Walk Through It.

Right now, you may feel like you are standing outside of something. You work hard and try your best, and still there is worry about money, fear about tomorrow, confusion about what is right, and a quiet question at night: Is this all there is?

You have probably tried to fix each problem one by one. But they keep coming back, because they are not the real problem. They are symptoms. The real problem is that you are cut off from the power you were built to run on. You have been standing outside, and nobody told you there was a door.

There is one. Jesus announced it: the Kingdom of God is at hand, so repent and believe. And every time the New Testament shows someone walking through that door, it follows the same pattern. They turn to God. They are baptized. They receive the Holy Spirit. Three steps. One doorway.

This book takes you through that doorway, one step at a time, straight from Scripture and in plain words. You will see what real repentance is, and why feeling sorry is not it. You will see why believers in the Bible were baptized by immersion straight away. And you will see how the Holy Spirit moves from beside you to inside you, with real power.

Walk through the door, and you stop being ruled by your circumstances. You start living under Heaven's rule.

## Three Steps. One Door.

Here is the doorway, and where this book takes you through each part of it:

- Step One: Repentance, the Turn. A change of mind that changes your direction (Chapter Two).
- Step Two: Water Baptism, the Burial. The old life buried, the new life raised (Chapter Three).
- Step Three: The Holy Spirit, the Filling. God Himself living inside you, with power (Chapter Four).

## What Waits for You on the Other Side

As you walk through each step, this book will:

- Show you why money, power, and knowledge never fix the ache, and what the real root cause is.
- Explain true repentance, a change of mind and direction, through the stories of David, Zacchaeus, and the prodigal son, and show how it differs from regret.
- Show you baptism by immersion as a death, a burial, and a resurrection, and why the Bible never tells anyone to wait.
- Reveal who the Holy Spirit is and what happens when He comes: power, boldness, a changed character, gifts, help in prayer, and a seal that says you belong to God.
- Prepare you for life after the door: restored, not only forgiven, a child and heir of God, and Heaven's ambassador.$bp$),
      "descriptionFr" = COALESCE(NULLIF("descriptionFr", ''), $bp$_Repentez-vous. Soyez baptisés. Recevez l'Esprit._

_Livre Deux de la Série du Royaume_

_Évangéliste Stanley A. Ndoh | The God Nation Media & Leadership Academy_

# Il y a une porte. Et vous avez été fait pour la franchir.

En ce moment, vous avez peut-être l'impression d'être resté à l'extérieur de quelque chose. Vous travaillez dur, vous faites de votre mieux, et pourtant il y a l'inquiétude pour l'argent, la peur du lendemain, la confusion sur ce qui est juste, et une question silencieuse la nuit : Est-ce tout ce qu'il y a ?

Vous avez probablement essayé de régler chaque problème un par un. Mais ils reviennent toujours, parce qu'ils ne sont pas le vrai problème. Ce sont des symptômes. Le vrai problème, c'est que vous êtes coupé de la puissance sur laquelle vous avez été conçu pour fonctionner. Vous êtes resté dehors, et personne ne vous a dit qu'il y avait une porte.

Il y en a une. Jésus l'a annoncée : le Royaume de Dieu est proche, repentez-vous et croyez. Et chaque fois que le Nouveau Testament montre quelqu'un qui franchit cette porte, c'est selon le même modèle. Il se tourne vers Dieu. Il est baptisé. Il reçoit le Saint-Esprit. Trois étapes. Une seule porte d'entrée.

Ce livre vous fait passer cette porte d'entrée, une étape à la fois, directement à partir de l'Écriture et avec des mots simples. Vous verrez ce qu'est la vraie repentance, et pourquoi regretter n'en est pas une. Vous verrez pourquoi les croyants de la Bible étaient baptisés par immersion tout de suite. Et vous verrez comment le Saint-Esprit passe de à côté de vous à l'intérieur de vous, avec une vraie puissance.

Franchissez la porte, et vous cessez d'être gouverné par vos circonstances. Vous commencez à vivre sous le règne du Ciel.

## Trois étapes. Une porte.

Voici la porte d'entrée, et où ce livre vous fait passer chaque partie :

- Étape un : La repentance, le retournement. Un changement d'esprit qui change votre direction (chapitre deux).
- Étape deux : Le baptême d'eau, l'ensevelissement. L'ancienne vie ensevelie, la nouvelle vie relevée (chapitre trois).
- Étape trois : Le Saint-Esprit, le remplissage. Dieu lui-même qui habite en vous, avec puissance (chapitre quatre).

## Ce qui vous attend de l'autre côté

En franchissant chaque étape, ce livre va :

- Vous montrer pourquoi l'argent, le pouvoir et la connaissance ne guérissent jamais le malaise, et quelle est la vraie cause profonde.
- Expliquer la vraie repentance, un changement d'esprit et de direction, à travers les histoires de David, de Zachée et du fils prodigue, et montrer en quoi elle diffère du regret.
- Vous montrer le baptême par immersion comme une mort, un ensevelissement et une résurrection, et pourquoi la Bible ne dit jamais à personne d'attendre.
- Révéler qui est le Saint-Esprit et ce qui se passe quand il vient : puissance, hardiesse, un caractère changé, des dons, une aide dans la prière, et un sceau qui dit que vous appartenez à Dieu.
- Vous préparer à la vie après la porte : rétabli, et pas seulement pardonné, enfant et héritier de Dieu, et ambassadeur du Ciel.$bp$),
      "closingEn" = COALESCE(NULLIF("closingEn", ''), $bp$## This Book Is For You If...

- You feel an emptiness that nothing has filled, and you want to know why.
- You have heard about repentance, baptism, and the Holy Spirit, but never understood them clearly.
- You are new to the faith and want a firm foundation.
- You are a believer, and you want to be sure you have truly been through the whole doorway, including baptism and the Holy Spirit.
- You want to lead others, and you need to know how to bring them in.

## Do Not Stay Outside Any Longer

Every strong house needs a foundation, and this is the foundation. It is Book Two of the Kingdom Series, and everything that follows is built on it. The door is already open. Start here, and the rest of the journey will make sense.

*The door is open. Walk through it today.*

Get your copy of The Doorway Into the Kingdom today. It is the next step to continue your leadership studies and become part of The God Nation leadership team, as we spread the Gospel through modern media.

*Walk in it. Grow in it. Then help us bring others to it.*$bp$),
      "closingFr" = COALESCE(NULLIF("closingFr", ''), $bp$## Ce livre est pour vous si...

- Vous ressentez un vide que rien n'a comblé, et vous voulez savoir pourquoi.
- Vous avez entendu parler de la repentance, du baptême et du Saint-Esprit, mais ne les avez jamais clairement compris.
- Vous êtes nouveau dans la foi et voulez un fondement solide.
- Vous êtes croyant, et vous voulez être sûr d'avoir vraiment franchi toute la porte d'entrée, y compris le baptême et le Saint-Esprit.
- Vous voulez diriger les autres, et vous avez besoin de savoir comment les y faire entrer.

## Ne restez plus dehors

Toute maison solide a besoin d'une fondation, et voici la fondation. C'est le Livre Deux de la Série du Royaume, et tout ce qui suit est bâti dessus. La porte est déjà ouverte. Commencez ici, et la suite du voyage prendra tout son sens.

*La porte est ouverte. Franchissez-la aujourd'hui.*

Procurez-vous votre exemplaire de La Porte d'entrée du Royaume dès aujourd'hui. C'est la prochaine étape pour poursuivre vos études de leadership et faire partie de l'équipe de leadership de The God Nation, alors que nous répandons l'Évangile grâce aux médias modernes.

*Marchez-y. Grandissez-y. Puis aidez-nous à y amener les autres.*$bp$),
      "chaptersHeadingEn" = COALESCE(NULLIF("chaptersHeadingEn", ''), $bp$Inside the Book: Chapter by Chapter
Here is what you will find as you move from outside the door to inside the Kingdom.$bp$),
      "chaptersHeadingFr" = COALESCE(NULLIF("chaptersHeadingFr", ''), $bp$À l'intérieur du livre : chapitre par chapitre
Voici ce que vous trouverez en passant de l'extérieur de la porte à l'intérieur du Royaume.$bp$),
      "updatedAt" = NOW()
  WHERE "id" = b_id;

  INSERT INTO "BookChapter" ("id", "bookId", "order", "labelEn", "labelFr", "titleEn", "titleFr", "summaryEn", "summaryFr", "updatedAt")
  SELECT gen_random_uuid()::text, b_id, v."order", v."labelEn", v."labelFr", v."titleEn", v."titleFr", v."summaryEn", v."summaryFr", NOW()
  FROM (VALUES
    (1, $bp$From the Author$bp$, $bp$Mot de l'auteur$bp$, $bp$This Is Not Just Information. It Is a Summons.$bp$, $bp$Ce n'est pas seulement de l'information. C'est une convocation.$bp$, $bp$Before you reach the door, hear the heart behind it. This book is not written to fill your head with facts. It is a call to a new identity and a new way of living, built on three foundations: repentance, baptism, and the Holy Spirit. Expect the way you think, speak, and lead to change.$bp$, $bp$Avant d'arriver à la porte, écoutez le cœur qui est derrière. Ce livre n'est pas écrit pour remplir votre tête de faits. C'est un appel à une nouvelle identité et à une nouvelle manière de vivre, bâtie sur trois fondations : la repentance, le baptême et le Saint-Esprit. Attendez-vous à ce que votre manière de penser, de parler et de diriger change.$bp$),
    (2, $bp$Introduction$bp$, $bp$Introduction$bp$, $bp$Three Foundations. One Doorway.$bp$, $bp$Trois fondations. Une seule porte d'entrée.$bp$, $bp$Those three steps are not advanced topics for "later". They are the base that all mature Christian life stands on. This opening shows how they fit together as one door, and why a life built without them keeps shaking.$bp$, $bp$Ces trois étapes ne sont pas des sujets avancés pour « plus tard ». Elles sont la base sur laquelle repose toute vie chrétienne mûre. Cette ouverture montre comment elles s'assemblent en une seule porte, et pourquoi une vie bâtie sans elles continue de trembler.$bp$),
    (3, $bp$Chapter One$bp$, $bp$Chapitre Un$bp$, $bp$A World Operating Without Heaven$bp$, $bp$Un monde qui fonctionne sans le Ciel$bp$, $bp$This is why you have been standing outside. You were built for a purpose, and you have been running without the power that goes with it, like a phone that looks fine but is not plugged in. Discover what went wrong in the garden, why money troubles, fear, confusion, and emptiness are only symptoms, and why even Solomon, with everything, found no answer. Then hear the simple announcement of Jesus, and see the three-part door that undoes, step by step, what was lost.$bp$, $bp$C'est pourquoi vous êtes resté dehors. Vous avez été conçu pour un but, et vous avez fonctionné sans la puissance qui l'accompagne, comme un téléphone qui paraît en bon état mais n'est pas branché. Découvrez ce qui a mal tourné dans le jardin, pourquoi les ennuis d'argent, la peur, la confusion et le vide ne sont que des symptômes, et pourquoi même Salomon, avec tout, n'a trouvé aucune réponse. Écoutez ensuite la simple annonce de Jésus, et voyez la porte en trois parties qui défait, étape par étape, ce qui avait été perdu.$bp$),
    (4, $bp$Chapter Two$bp$, $bp$Chapitre Deux$bp$, $bp$The Turn: Repentance$bp$, $bp$Le retournement : la repentance$bp$, $bp$The first step through the door is the one most people think they already understand. Most believe repentance means feeling bad and trying harder. It does not, and that is why so many never really change. Learn what the word truly means: a change of mind that changes your direction. It is the fix, not the punishment. Meet David, Zacchaeus, and the prodigal son, who turned. Then meet Pharaoh, Judas, and Simon, who only regretted. The chapter ends with a simple prayer, so you can make the turn right where you are.$bp$, $bp$La première étape de la porte est celle que la plupart pensent déjà comprendre. Beaucoup croient que se repentir, c'est se sentir mal et essayer plus fort. Ce n'est pas cela, et c'est pourquoi tant de gens ne changent jamais vraiment. Apprenez ce que le mot signifie vraiment : un changement d'esprit qui change votre direction. C'est le remède, pas la punition. Rencontrez David, Zachée et le fils prodigue, qui se sont retournés. Rencontrez ensuite Pharaon, Judas et Simon, qui n'ont fait que regretter. Le chapitre se termine par une prière simple, pour que vous puissiez faire le retournement là où vous êtes.$bp$),
    (5, $bp$Chapter Three$bp$, $bp$Chapitre Trois$bp$, $bp$The Burial: Water Baptism$bp$, $bp$L'ensevelissement : le baptême d'eau$bp$, $bp$Once you have turned, the next step makes your decision real. A choice made in the heart becomes settled when it is made public, like a wedding day. The word baptism itself means to immerse: you go under, and you come back up. The old life dies and is buried, and a new life rises. Follow Jesus into the Jordan, and see how the believers in Acts did not wait. Some were baptized the same day, even the same hour. The chapter closes with a declaration that puts your new identity into words.$bp$, $bp$Une fois que vous vous êtes retourné, l'étape suivante rend votre décision réelle. Un choix fait dans le cœur devient établi quand il est rendu public, comme un jour de mariage. Le mot baptême lui-même signifie immerger : on descend sous l'eau, et on remonte. L'ancienne vie meurt et est ensevelie, et une vie nouvelle se relève. Suivez Jésus dans le Jourdain, et voyez comment les croyants des Actes n'ont pas attendu. Certains ont été baptisés le jour même, à l'heure même. Le chapitre se termine par une déclaration qui met votre nouvelle identité en mots.$bp$),
    (6, $bp$Chapter Four$bp$, $bp$Chapitre Quatre$bp$, $bp$The Filling: The Holy Spirit$bp$, $bp$Le remplissage : le Saint-Esprit$bp$, $bp$Changing direction is not enough. You need power to walk the new road, and this is the third step. The Holy Spirit is not a force or a feeling. He is God Himself, no longer around you but inside you. See how He came at Pentecost, in Samaria, to Cornelius' house, and in Ephesus, where believers spoke with other tongues. Discover what He brings: power, boldness, fruit, gifts, help in prayer, and a seal that marks you as God's. He is a gift to receive, not a prize to earn.$bp$, $bp$Changer de direction ne suffit pas. Il vous faut de la puissance pour marcher sur la nouvelle route, et c'est la troisième étape. Le Saint-Esprit n'est ni une force ni un sentiment. Il est Dieu lui-même, plus autour de vous mais en vous. Voyez comment il est venu à la Pentecôte, en Samarie, dans la maison de Corneille et à Éphèse, où les croyants ont parlé en d'autres langues. Découvrez ce qu'il apporte : puissance, hardiesse, fruit, dons, aide dans la prière, et un sceau qui vous marque comme appartenant à Dieu. Il est un don à recevoir, pas un prix à mériter.$bp$),
    (7, $bp$Chapter Five$bp$, $bp$Chapitre Cinq$bp$, $bp$Through the Door: What Now?$bp$, $bp$Franchir la porte : et maintenant ?$bp$, $bp$Now you are inside, and the journey really begins. Find out what you now have: you were not only forgiven, you were restored. You are a child and heir of God, Heaven's ambassador, salt and light wherever you go. The chapter points you to what comes next in the series, and the two questions it prepares you to ask: What do I have? And how do I use it?$bp$, $bp$Maintenant vous êtes à l'intérieur, et le voyage commence vraiment. Découvrez ce que vous avez désormais : vous n'avez pas seulement été pardonné, vous avez été rétabli. Vous êtes enfant et héritier de Dieu, ambassadeur du Ciel, sel et lumière partout où vous allez. Le chapitre vous oriente vers la suite de la série, et vers les deux questions qu'il vous prépare à poser : Qu'ai-je ? Et comment l'utiliser ?$bp$)
  ) AS v("order", "labelEn", "labelFr", "titleEn", "titleFr", "summaryEn", "summaryFr");
END
$load$;
