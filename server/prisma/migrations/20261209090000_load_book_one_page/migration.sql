-- Book One's page (The Restoration of Dominion), English and French, written by
-- the founder (the French was translated for him to review). Loads only when
-- Book 1 exists and has no chapters yet, so nothing he already wrote is ever
-- replaced; a description he already wrote is kept. Later edits made in the
-- app are never touched (this runs once).
DO $load$
DECLARE
  b_id TEXT;
BEGIN
  SELECT "id" INTO b_id FROM "LibraryBook" WHERE "kind" = 'TRAINING' AND "trainingOrder" = 1;
  IF b_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "BookChapter" WHERE "bookId" = b_id) THEN
    RETURN;
  END IF;

  UPDATE "LibraryBook"
  SET "descriptionEn" = COALESCE(NULLIF("descriptionEn", ''), $bp$_Book One of the Kingdom Series_

_Evangelist Stanley A. Ndoh | The God Nation Media & Leadership Academy_

# Stop Being Pushed Around by Life. Start Ruling Over It.

Are you tired of stress, money pressure, fear, and the feeling that life is always one step ahead of you? You are not weak, and you are not alone. Billions of people feel the same way, and most of them never find out why.

Here is the truth almost nobody tells you: you were never made to be dominated by circumstances. You were made to govern them. Something was lost a long time ago, and it is the hidden root behind the stress, the struggle, and the stuck feeling in your life. The good news is that it can be restored, and this book shows you exactly how.

In five powerful chapters, you will discover who you really are, what was taken from you, and how to step back into the authority, peace, and power you were created to live in. Short, plain, and straight to the point. You will not be able to read it and stay the same.

## What This Book Will Do For You

- Show you the real reason you feel stuck, stressed, or defeated, and it is not what you were told.
- Give you a clear picture of your true identity and why you matter.
- Teach you how to stop living under pressure and start living in authority.
- Open a simple, clear way to a new beginning, no matter your past.
- Prepare you to help your family, your friends, and others rise too.$bp$),
      "descriptionFr" = COALESCE(NULLIF("descriptionFr", ''), $bp$_Livre Un de la Série du Royaume_

_Évangéliste Stanley A. Ndoh | The God Nation Media & Leadership Academy_

# Arrêtez de vous laisser bousculer par la vie. Commencez à la gouverner.

Êtes-vous fatigué du stress, de la pression financière, de la peur, et de cette impression que la vie a toujours une longueur d'avance sur vous ? Vous n'êtes pas faible, et vous n'êtes pas seul. Des milliards de personnes ressentent la même chose, et la plupart ne découvrent jamais pourquoi.

Voici la vérité que presque personne ne vous dit : vous n'avez jamais été créé pour être dominé par les circonstances. Vous avez été créé pour les gouverner. Quelque chose a été perdu il y a très longtemps, et c'est la racine cachée du stress, du combat et du sentiment d'être bloqué dans votre vie. La bonne nouvelle, c'est que cela peut être restauré, et ce livre vous montre exactement comment.

En cinq chapitres puissants, vous découvrirez qui vous êtes vraiment, ce qui vous a été enlevé, et comment retrouver l'autorité, la paix et la puissance pour lesquelles vous avez été créé. Court, simple et direct. Vous ne pourrez pas le lire et rester le même.

## Ce que ce livre fera pour vous

- Vous montrer la vraie raison pour laquelle vous vous sentez bloqué, stressé ou vaincu, et ce n'est pas ce qu'on vous a dit.
- Vous donner une image claire de votre véritable identité et de la raison pour laquelle vous comptez.
- Vous apprendre à cesser de vivre sous la pression et à commencer à vivre dans l'autorité.
- Ouvrir un chemin simple et clair vers un nouveau départ, quel que soit votre passé.
- Vous préparer à aider votre famille, vos amis et d'autres personnes à se relever aussi.$bp$),
      "closingEn" = COALESCE(NULLIF("closingEn", ''), $bp$## This Book Is For You If...

- You feel stressed, stuck, or pressed on every side, and you want a way out.
- You are searching for something real, and nothing so far has filled the emptiness.
- You already believe in Jesus, but you know there is more power and purpose waiting for you.
- You want to lead, teach, or help others, and you need a strong foundation.
- You are ready for change, and you are tired of the same cycle.

## Why Read It Now?

Because every day you wait is another day of living below what you were made for. This is Book One of the Kingdom Series, the foundation that everything else is built on. Start here, and the rest of the journey will make sense.

*Your restoration begins on page one.*

Get your copy of The Restoration of Dominion today. It is the first step to begin your leadership studies and become part of The God Nation leadership team, as we spread the Gospel through modern media.

*Read it. Rise in it. Then help us carry it to the world.*$bp$),
      "closingFr" = COALESCE(NULLIF("closingFr", ''), $bp$## Ce livre est pour vous si...

- Vous vous sentez stressé, bloqué ou pressé de tous côtés, et vous voulez une issue.
- Vous cherchez quelque chose de réel, et rien jusqu'ici n'a comblé le vide.
- Vous croyez déjà en Jésus, mais vous savez qu'il y a plus de puissance et de destinée qui vous attendent.
- Vous voulez diriger, enseigner ou aider les autres, et vous avez besoin d'un fondement solide.
- Vous êtes prêt pour le changement, et vous en avez assez du même cycle.

## Pourquoi le lire maintenant ?

Parce que chaque jour d'attente est un jour de plus passé en dessous de ce pour quoi vous avez été créé. Ceci est le Livre Un de la Série du Royaume, le fondement sur lequel tout le reste est bâti. Commencez ici, et la suite du voyage prendra tout son sens.

*Votre restauration commence à la première page.*

Procurez-vous votre exemplaire de La Restauration de la Domination dès aujourd'hui. C'est le premier pas pour commencer vos études de leadership et faire partie de l'équipe de leadership de The God Nation, alors que nous répandons l'Évangile grâce aux médias modernes.

*Lisez-le. Élevez-vous. Puis aidez-nous à le porter au monde entier.*$bp$),
      "chaptersHeadingEn" = COALESCE(NULLIF("chaptersHeadingEn", ''), $bp$Chapter by Chapter: Your Journey to Dominion$bp$),
      "chaptersHeadingFr" = COALESCE(NULLIF("chaptersHeadingFr", ''), $bp$Chapitre par chapitre : votre voyage vers la domination$bp$),
      "updatedAt" = NOW()
  WHERE "id" = b_id;

  INSERT INTO "BookChapter" ("id", "bookId", "order", "labelEn", "labelFr", "titleEn", "titleFr", "summaryEn", "summaryFr", "updatedAt")
  SELECT gen_random_uuid()::text, b_id, v."order", v."labelEn", v."labelFr", v."titleEn", v."titleFr", v."summaryEn", v."summaryFr", NOW()
  FROM (VALUES
    (1, $bp$Introduction$bp$, $bp$Introduction$bp$, $bp$Why Are We Still Not Free?$bp$, $bp$Pourquoi ne sommes-nous toujours pas libres ?$bp$, $bp$You work hard. You try your best. Yet peace and freedom still seem out of reach. This opening names the question that every person on earth quietly asks, and gives you the first shock of truth: the answer is not a better job, a bigger salary, or a visa to another country. People everywhere are searching for the same hidden thing, and you are about to find out what it is.$bp$, $bp$Vous travaillez dur. Vous faites de votre mieux. Pourtant, la paix et la liberté semblent toujours hors de portée. Cette ouverture pose la question que chaque personne sur terre se pose en silence, et vous donne le premier choc de vérité : la réponse n'est ni un meilleur emploi, ni un salaire plus élevé, ni un visa pour un autre pays. Partout, les gens cherchent la même chose cachée, et vous êtes sur le point de découvrir ce que c'est.$bp$),
    (2, $bp$Chapter One$bp$, $bp$Chapitre Un$bp$, $bp$You Were Born to Rule, Not to Struggle$bp$, $bp$Vous êtes né pour régner, pas pour lutter$bp$, $bp$Before the stress, before the fear, before the struggle, there was a design. In this chapter you will see who God made you to be: crowned with glory, made in His image, and given authority over your world. Discover how Adam, Solomon, and Daniel lived in this power, even in hostile places. By the end, you will see yourself in a whole new light, and you will never feel small again.$bp$, $bp$Avant le stress, avant la peur, avant le combat, il y avait un dessein. Dans ce chapitre, vous verrez qui Dieu vous a créé pour être : couronné de gloire, créé à Son image, et revêtu d'autorité sur votre monde. Découvrez comment Adam, Salomon et Daniel ont vécu dans cette puissance, même dans des lieux hostiles. À la fin, vous vous verrez sous un jour entièrement nouveau, et vous ne vous sentirez plus jamais petit.$bp$),
    (3, $bp$Chapter Two$bp$, $bp$Chapitre Deux$bp$, $bp$The Day Everything Was Stolen$bp$, $bp$Le jour où tout a été volé$bp$, $bp$Every fear, every battle, and every wall you face started somewhere. This chapter pulls back the curtain on the one event that took away humanity's peace, power, and authority, and the clever lie the enemy still uses on you today. You will understand why life became hard, why you feel disconnected, and why none of this was your fault. And right in the middle of the darkness, you will see the first promise of rescue.$bp$, $bp$Chaque peur, chaque bataille et chaque mur auquel vous faites face a commencé quelque part. Ce chapitre lève le rideau sur l'événement unique qui a ôté à l'humanité sa paix, sa puissance et son autorité, et sur le mensonge habile que l'ennemi utilise encore contre vous aujourd'hui. Vous comprendrez pourquoi la vie est devenue difficile, pourquoi vous vous sentez déconnecté, et pourquoi rien de tout cela n'était votre faute. Et au cœur même des ténèbres, vous verrez la première promesse de délivrance.$bp$),
    (4, $bp$Chapter Three$bp$, $bp$Chapitre Trois$bp$, $bp$A Kingdom Bigger Than Any Problem You Face$bp$, $bp$Un Royaume plus grand que n'importe quel problème que vous affrontez$bp$, $bp$What if there is a Kingdom more powerful than your bills, your sickness, your enemies, and your fears? There is, and it cannot be shaken or defeated. Step inside the throne room of Heaven with Isaiah and John, see the armies of Heaven standing around Elisha, and discover the one thing about this Kingdom that will change how you face every trouble. It is closer than you think.$bp$, $bp$Et s'il existait un Royaume plus puissant que vos factures, votre maladie, vos ennemis et vos peurs ? Il existe, et il ne peut être ni ébranlé ni vaincu. Entrez dans la salle du trône du Ciel avec Ésaïe et Jean, voyez les armées du Ciel qui entourent Élisée, et découvrez la seule chose à propos de ce Royaume qui changera votre manière d'affronter chaque épreuve. Il est plus proche que vous ne le pensez.$bp$),
    (5, $bp$Chapter Four$bp$, $bp$Chapitre Quatre$bp$, $bp$You Carry Heaven's Power Wherever You Go$bp$, $bp$Vous portez la puissance du Ciel partout où vous allez$bp$, $bp$This is where it gets personal. Heaven's power is not far away. It is meant to show up on earth through you. Learn what it means to be Heaven's ambassador, with authority, provision, and the full backing of a King behind you. See how one man changed a whole city, and how two men in chains shook a prison open. When you finish, you will know that you are not a victim of your circumstances. You are a carrier of the Kingdom.$bp$, $bp$C'est ici que cela devient personnel. La puissance du Ciel n'est pas lointaine. Elle est destinée à se manifester sur la terre à travers vous. Apprenez ce que signifie être l'ambassadeur du Ciel, avec autorité, provision et le plein soutien d'un Roi derrière vous. Voyez comment un seul homme a changé toute une ville, et comment deux hommes enchaînés ont fait trembler une prison jusqu'à l'ouvrir. Quand vous aurez terminé, vous saurez que vous n'êtes pas la victime de vos circonstances. Vous êtes un porteur du Royaume.$bp$),
    (6, $bp$Chapter Five$bp$, $bp$Chapitre Cinq$bp$, $bp$The Door Is Open. Walk In.$bp$, $bp$La porte est ouverte. Entrez.$bp$, $bp$Everything in this book has been leading to this. Here you will find the simple way back into the life you were made for. There are no complicated rituals and no years of religious effort. Meet people who thought they were too far gone, including a hated tax collector, a woman with a broken past, a dying thief, and a violent persecutor, and see how each one found a fresh start. You will also find a short, sincere prayer to begin your new life, and learn exactly what changes the moment you pray it.$bp$, $bp$Tout ce livre conduit à ce moment. Vous trouverez ici le chemin simple pour retourner à la vie pour laquelle vous avez été créé. Pas de rituels compliqués, pas d'années d'efforts religieux. Rencontrez des personnes qui se croyaient trop perdues, dont un collecteur d'impôts méprisé, une femme au passé brisé, un voleur mourant et un persécuteur violent, et voyez comment chacun a trouvé un nouveau départ. Vous trouverez aussi une courte prière sincère pour commencer votre nouvelle vie, et vous apprendrez exactement ce qui change à l'instant où vous la faites.$bp$),
    (7, $bp$Conclusion$bp$, $bp$Conclusion$bp$, $bp$You Were Made for This$bp$, $bp$Vous avez été créé pour cela$bp$, $bp$The story comes full circle, and so does your life. See what is already true of you as a citizen of the Kingdom: already seated, already positioned, already more than a conqueror. Be inspired by Joseph, who rose from prison to rule, and Esther, who was placed in her moment "for such a time as this." You will close the book with one clear thing: your own assignment, and the courage to start it.$bp$, $bp$L'histoire boucle la boucle, et votre vie aussi. Voyez ce qui est déjà vrai de vous en tant que citoyen du Royaume : déjà assis, déjà positionné, déjà plus que vainqueur. Laissez-vous inspirer par Joseph, qui s'est élevé de la prison pour gouverner, et par Esther, placée dans son moment « pour un temps comme celui-ci ». Vous terminerez le livre avec une chose claire : votre propre mission, et le courage de la commencer.$bp$),
    (8, $bp$Appendix A$bp$, $bp$Annexe A$bp$, $bp$Your Quick-Reference Guide$bp$, $bp$Votre guide de référence rapide$bp$, $bp$A simple glossary of the key words in the book, such as Dominion, The Fall, Born Again, and Ambassador, with Scripture for each. Keep it close and come back to it whenever you want to remember, teach, or share what you have learned.$bp$, $bp$Un simple glossaire des mots clés du livre, tels que Domination, La Chute, Né de nouveau et Ambassadeur, avec des versets bibliques pour chacun. Gardez-le à portée de main et revenez-y chaque fois que vous voulez vous souvenir, enseigner ou partager ce que vous avez appris.$bp$)
  ) AS v("order", "labelEn", "labelFr", "titleEn", "titleFr", "summaryEn", "summaryFr");
END
$load$;
