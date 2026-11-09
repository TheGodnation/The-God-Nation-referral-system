-- Book 3's page, English and French, written by the founder (the French was translated for him to
-- review). Loads only when the book exists and has no chapters yet, so nothing he already wrote is ever replaced;
-- a description he already wrote is kept. Later edits made in the app are never touched (this runs once).
DO $load$
DECLARE
  b_id TEXT;
BEGIN
  SELECT "id" INTO b_id FROM "LibraryBook" WHERE "kind" = 'TRAINING' AND "trainingOrder" = 3;
  IF b_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "BookChapter" WHERE "bookId" = b_id) THEN
    RETURN;
  END IF;

  UPDATE "LibraryBook"
  SET "descriptionEn" = COALESCE(NULLIF("descriptionEn", ''), $bp$_Unlocking the Rights of Kingdom Citizens for Visible Dominion on Earth_

_Evangelist Stanley A. Ndoh | The God Nation Media & Leadership Academy_

# You Already Own It. Now Learn How to Walk In It.

You pray. You fast. You serve. You give. You know the promises of God so well that you could quote them in your sleep. And still the sickness lingers, the bills pile up, the relationships strain, and the breakthrough you keep believing for has not come.

So you start to wonder. Is something wrong with me? Is God holding back? Is the Word really true?

Here is the answer, and it will change how you face every problem from today. Nothing is wrong with God, and nothing is wrong with His promises. Everything you need has already been provided. The Bible says you were blessed with every spiritual blessing in Christ, and it says it as something finished. The problem is not what you own. The problem is the gap between what you own and what you are actually using.

That gap has a cause, and a cause can be fixed. Millions of believers live like a man who inherits a great estate and sleeps in a roadside tent because no one ever showed him how to get inside. This book shows you how. It hands you the keys.

This is Volume One of Kingdom Keys, and it is where the whole journey begins. Here you stop being a victim of circumstances and become a citizen who knows how the Kingdom works and how to use what has been put in your hands.

## Three Gaps. One Set of Keys.

Before you can close the gap, you need to see exactly where it opens. This book shows you the three places where believers get stuck:

- The gap of identity: not knowing who you really are in Christ.
- The gap of knowledge: not knowing how the Kingdom actually works.
- The gap of application: knowing the truth, but never putting it to work.

Find which one is yours, and you will finally know what to do about it.

## What You Will Walk Away With

- A clear answer to the question that has troubled you for years: why is so little of what God promised showing up in my life?
- Confidence that your rights are settled, so you stop striving to earn them and stop waiting passively for them.
- A simple way to meet every problem: instead of asking why this is happening, you ask which key opens this door.
- Understanding of how the Kingdom runs, through its laws, its protocols, and its order, so your results become steady and not random.
- A firm foundation in your new identity, the one thing no circumstance can shake.$bp$),
      "descriptionFr" = COALESCE(NULLIF("descriptionFr", ''), $bp$_Libérer les droits des citoyens du Royaume pour une domination visible sur la terre_

_Évangéliste Stanley A. Ndoh | The God Nation Media & Leadership Academy_

# Vous le possédez déjà. Apprenez maintenant à y marcher.

Vous priez. Vous jeûnez. Vous servez. Vous donnez. Vous connaissez si bien les promesses de Dieu que vous pourriez les réciter en dormant. Et pourtant la maladie persiste, les factures s'accumulent, les relations se tendent, et la percée que vous continuez de croire n'est pas venue.

Alors vous commencez à vous demander. Y a-t-il quelque chose qui ne va pas chez moi ? Dieu retient-il quelque chose ? La Parole est-elle vraiment vraie ?

Voici la réponse, et elle changera votre manière d'affronter chaque problème dès aujourd'hui. Rien ne va mal chez Dieu, et rien ne va mal dans ses promesses. Tout ce dont vous avez besoin a déjà été fourni. La Bible dit que vous avez été béni de toute bénédiction spirituelle en Christ, et elle le dit comme quelque chose d'achevé. Le problème n'est pas ce que vous possédez. Le problème, c'est l'écart entre ce que vous possédez et ce que vous utilisez réellement.

Cet écart a une cause, et une cause peut être corrigée. Des millions de croyants vivent comme un homme qui hérite d'un grand domaine et dort sous une tente au bord de la route parce que personne ne lui a montré comment entrer. Ce livre vous montre comment. Il vous remet les clés.

Ceci est le Volume Un des Clés du Royaume, et c'est là que commence tout le voyage. Ici, vous cessez d'être victime des circonstances et vous devenez un citoyen qui sait comment le Royaume fonctionne et comment utiliser ce qui a été mis entre ses mains.

## Trois écarts. Un trousseau.

Avant de pouvoir combler l'écart, vous devez voir exactement où il s'ouvre. Ce livre vous montre les trois endroits où les croyants se retrouvent bloqués :

- L'écart de l'identité : ne pas savoir qui vous êtes vraiment en Christ.
- L'écart de la connaissance : ne pas savoir comment le Royaume fonctionne réellement.
- L'écart de l'application : connaître la vérité, mais ne jamais la mettre en œuvre.

Trouvez lequel est le vôtre, et vous saurez enfin quoi faire.

## Ce que vous emporterez

- Une réponse claire à la question qui vous trouble depuis des années : pourquoi si peu de ce que Dieu a promis apparaît-il dans ma vie ?
- L'assurance que vos droits sont établis, pour cesser de vous efforcer de les mériter et de les attendre passivement.
- Une manière simple d'affronter chaque problème : au lieu de demander pourquoi cela arrive, vous demandez quelle clé ouvre cette porte.
- La compréhension de la façon dont le Royaume fonctionne, par ses lois, ses protocoles et son ordre, pour que vos résultats deviennent constants et non aléatoires.
- Un fondement solide dans votre nouvelle identité, la seule chose qu'aucune circonstance ne peut ébranler.$bp$),
      "closingEn" = COALESCE(NULLIF("closingEn", ''), $bp$## This Book Is For You If...

- You are a sincere believer who prays and believes, and you are tired of the gap between the promise and your reality.
- You want to be on top of your circumstances, not underneath them.
- You are new to the faith and want to start on a solid foundation.
- You are a leader who wants to teach others how to walk in what is already theirs.
- You want to know how the Kingdom works, so your results stop depending on luck.

## The Keys Are Already in Your Hand

Everything you need was settled at the Cross. The only thing left is to learn how to use it. This is Volume One of a five-volume journey, and every other key in the series rests on the foundation laid here. Start here, close the gap, and watch what happens when a citizen finally learns to use the keys.

*The Kingdom is yours. The keys are in your hand. Now open the door.*

Get your copy of Kingdom Keys, Volume 1: The Foundation today. It is the next step to continue your leadership studies and become part of The God Nation leadership team, as we spread the Gospel through modern media.$bp$),
      "closingFr" = COALESCE(NULLIF("closingFr", ''), $bp$## Ce livre est pour vous si...

- Vous êtes un croyant sincère qui prie et qui croit, et vous êtes fatigué de l'écart entre la promesse et votre réalité.
- Vous voulez être au-dessus de vos circonstances, et non en dessous.
- Vous êtes nouveau dans la foi et voulez partir sur un fondement solide.
- Vous êtes un dirigeant qui veut enseigner aux autres comment marcher dans ce qui est déjà à eux.
- Vous voulez savoir comment le Royaume fonctionne, pour que vos résultats cessent de dépendre de la chance.

## Les clés sont déjà dans votre main

Tout ce dont vous avez besoin a été établi à la Croix. Il ne reste qu'à apprendre à s'en servir. Ceci est le Volume Un d'un voyage en cinq volumes, et chaque autre clé de la série repose sur le fondement posé ici. Commencez ici, comblez l'écart, et regardez ce qui arrive quand un citoyen apprend enfin à utiliser les clés.

*Le Royaume est à vous. Les clés sont dans votre main. Ouvrez la porte.*

Procurez-vous votre exemplaire de Les Clés du Royaume, Volume 1 : Le Fondement dès aujourd'hui. C'est la prochaine étape pour poursuivre vos études de leadership et faire partie de l'équipe de leadership de The God Nation, alors que nous répandons l'Évangile grâce aux médias modernes.$bp$),
      "chaptersHeadingEn" = COALESCE(NULLIF("chaptersHeadingEn", ''), $bp$Inside the Book: Chapter by Chapter
Here is how the book carries you from the gap in your life to the first key in your hand.$bp$),
      "chaptersHeadingFr" = COALESCE(NULLIF("chaptersHeadingFr", ''), $bp$À l'intérieur du livre : chapitre par chapitre
Voici comment le livre vous conduit de l'écart dans votre vie à la première clé dans votre main.$bp$),
      "updatedAt" = NOW()
  WHERE "id" = b_id;

  INSERT INTO "BookChapter" ("id", "bookId", "order", "labelEn", "labelFr", "titleEn", "titleFr", "summaryEn", "summaryFr", "updatedAt")
  SELECT gen_random_uuid()::text, b_id, v."order", v."labelEn", v."labelFr", v."titleEn", v."titleFr", v."summaryEn", v."summaryFr", NOW()
  FROM (VALUES
    (1, $bp$Foreword and Introduction$bp$, $bp$Avant-propos et Introduction$bp$, $bp$The Problem Every Kingdom Citizen Must Solve$bp$, $bp$Le problème que tout citoyen du Royaume doit résoudre$bp$, $bp$Start by hearing the question behind the whole series: I know what my rights are, so how do I actually walk in them? You are shown why having rights and having keys are two different things, why the Cross finished the work but did not remove your part in it, and what Paul's life shows about honouring grace by engaging with it. This is the map for everything that follows.$bp$, $bp$Commencez par entendre la question qui est derrière toute la série : je sais quels sont mes droits, alors comment y marcher vraiment ? On vous montre pourquoi avoir des droits et avoir des clés sont deux choses différentes, pourquoi la Croix a achevé l'œuvre sans retirer votre part dans celle-ci, et ce que la vie de Paul montre sur le fait d'honorer la grâce en s'y engageant. C'est la carte pour tout ce qui suit.$bp$),
    (2, $bp$Chapter One$bp$, $bp$Chapitre Un$bp$, $bp$You Are Already Rich. So Why Are You Still Poor?$bp$, $bp$Vous êtes déjà riche. Alors pourquoi êtes-vous encore pauvre ?$bp$, $bp$This is the chapter that explains the ache. Your lack is never a sign that God has failed to provide. It is the gap between what was provided and what you have reached. Meet Gideon, a man hiding in a winepress who heaven called a mighty man of valour. Learn the three gaps, see why a house wired with electricity is not lit until someone flips the switch, and take the first practical steps to close your own gap.$bp$, $bp$C'est le chapitre qui explique le malaise. Votre manque n'est jamais le signe que Dieu n'a pas pourvu. C'est l'écart entre ce qui a été fourni et ce que vous avez atteint. Rencontrez Gédéon, un homme caché dans un pressoir que le Ciel a appelé vaillant héros. Apprenez les trois écarts, voyez pourquoi une maison câblée d'électricité n'est pas éclairée tant que personne n'actionne l'interrupteur, et faites les premiers pas pratiques pour combler votre propre écart.$bp$),
    (3, $bp$Chapter Two$bp$, $bp$Chapitre Deux$bp$, $bp$The Finished Work and the Open Door$bp$, $bp$L'œuvre achevée et la porte ouverte$bp$, $bp$Now that you see the gap, you need to know what Christ completed and what He left in your hands. Two errors have trapped believers for generations: sitting back because Christ did it all, and straining to earn what He already gave. You will see what the Cross truly finished, why the blood of the Passover lamb had to be applied, how a widow's oil flowed as far as her vessels went, and why Naaman almost lost his healing to pride. You will learn to work the keys from rest, not from fear.$bp$, $bp$Maintenant que vous voyez l'écart, vous devez savoir ce que Christ a accompli et ce qu'il a laissé entre vos mains. Deux erreurs ont piégé des croyants pendant des générations : rester les bras croisés parce que Christ a tout fait, et se tendre pour mériter ce qu'il a déjà donné. Vous verrez ce que la Croix a vraiment achevé, pourquoi le sang de l'agneau de la Pâque devait être appliqué, comment l'huile d'une veuve a coulé aussi loin que ses vases, et pourquoi Naaman a failli perdre sa guérison à cause de l'orgueil. Vous apprendrez à utiliser les clés à partir du repos, et non de la peur.$bp$),
    (4, $bp$Chapter Three$bp$, $bp$Chapitre Trois$bp$, $bp$Rights Without Keys: The Tragedy of the Uninformed Heir$bp$, $bp$Des droits sans clés : la tragédie de l'héritier mal informé$bp$, $bp$If rights are settled, why do so many live poor? This chapter answers with a true story of a farmer who lived and died in poverty on top of a fortune in coal that he never knew was there. You will see what ignorance really costs, from the ten spies who saw themselves as grasshoppers, to Mephibosheth, a prince living in a place called Lo Debar, who thought he was nothing but a dead dog until the king sent for him. You will learn how knowledge pulls down the strongholds in your mind, and you will find your own Lo Debar.$bp$, $bp$Si les droits sont établis, pourquoi tant de gens vivent-ils dans la pauvreté ? Ce chapitre répond par l'histoire vraie d'un fermier qui a vécu et est mort pauvre sur une fortune en charbon dont il ignorait l'existence. Vous verrez ce que coûte vraiment l'ignorance, des dix espions qui se voyaient comme des sauterelles à Mephibosheth, un prince vivant dans un lieu appelé Lo-Debar, qui se croyait un chien mort jusqu'à ce que le roi l'envoie chercher. Vous apprendrez comment la connaissance abat les forteresses dans votre esprit, et vous trouverez votre propre Lo-Debar.$bp$),
    (5, $bp$Chapter Four$bp$, $bp$Chapitre Quatre$bp$, $bp$Understanding Kingdom Systems$bp$, $bp$Comprendre les systèmes du Royaume$bp$, $bp$Knowing your rights is only half the answer. You also need to understand how the Kingdom runs. This chapter opens the system: its laws, its protocols, and its divine order. You will see the five systems that sit under every key: the Word, prayer, faith, covenant, and sowing and reaping. Through Joseph, David, Daniel, and the woman who touched Christ's garment, you will see these systems at work. Then you will learn to treat every challenge as a question of which system to engage, so you stop reacting and start responding with strategy.$bp$, $bp$Connaître vos droits n'est que la moitié de la réponse. Il faut aussi comprendre comment le Royaume fonctionne. Ce chapitre ouvre le système : ses lois, ses protocoles et son ordre divin. Vous verrez les cinq systèmes qui sont sous chaque clé : la Parole, la prière, la foi, l'alliance, et le semer et le récolter. À travers Joseph, David, Daniel et la femme qui a touché le vêtement de Christ, vous verrez ces systèmes à l'œuvre. Puis vous apprendrez à traiter chaque défi comme une question de savoir quel système engager, pour cesser de réagir et commencer à répondre avec stratégie.$bp$),
    (6, $bp$Chapter Five$bp$, $bp$Chapitre Cinq$bp$, $bp$What Are the Keys of the Kingdom?$bp$, $bp$Que sont les clés du Royaume ?$bp$, $bp$At last you hold the keys in your hands. This chapter defines exactly what a Kingdom Key is, shows the four things that must line up for a key to turn, and reveals the many names the Bible uses for the same reality: mysteries, wisdom, righteousness, the ways of God. You will also see the full map of the series: fifty-three keys, in five volumes and seven tiers, from who you are all the way to how you change the world around you. You do not need all of them to begin. You need the ones that fit the door in front of you.$bp$, $bp$Enfin vous tenez les clés dans vos mains. Ce chapitre définit exactement ce qu'est une clé du Royaume, montre les quatre choses qui doivent s'aligner pour qu'une clé tourne, et révèle les nombreux noms que la Bible utilise pour la même réalité : mystères, sagesse, justice, voies de Dieu. Vous verrez aussi la carte complète de la série : cinquante-trois clés, en cinq volumes et sept niveaux, de qui vous êtes jusqu'à la manière de changer le monde autour de vous. Vous n'avez pas besoin de toutes pour commencer. Il vous faut celles qui correspondent à la porte qui est devant vous.$bp$),
    (7, $bp$Chapter Six$bp$, $bp$Chapitre Six$bp$, $bp$The Key of the New Birth$bp$, $bp$La clé de la nouvelle naissance$bp$, $bp$The first key is the one that makes all the others work. A key can only be turned by someone who has the right to use it, and that right begins with being born again. You will see exactly what changes when a person is born into the Kingdom: nature, legal standing, spiritual family, spiritual capacity, and present authority. You will walk with Nicodemus and Zacchaeus, and see why the sons of Sceva failed. Whether you are receiving Christ for the first time or confirming what you already have, a prayer is waiting at the end of this chapter, and so is the platform from which you will turn every other key.$bp$, $bp$La première clé est celle qui fait fonctionner toutes les autres. Une clé ne peut être tournée que par celui qui a le droit de s'en servir, et ce droit commence par le fait d'être né de nouveau. Vous verrez exactement ce qui change quand une personne naît dans le Royaume : la nature, la position légale, la famille spirituelle, la capacité spirituelle et l'autorité présente. Vous marcherez avec Nicodème et Zachée, et verrez pourquoi les fils de Scéva ont échoué. Que vous receviez Christ pour la première fois ou que vous confirmiez ce que vous avez déjà, une prière vous attend à la fin de ce chapitre, ainsi que la plateforme à partir de laquelle vous tournerez toutes les autres clés.$bp$)
  ) AS v("order", "labelEn", "labelFr", "titleEn", "titleFr", "summaryEn", "summaryFr");
END
$load$;
