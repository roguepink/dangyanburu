'use strict';

/* 「今日のメッセージ」生成エンジン（端末内で動作・日英対応）。
   - 断定的な効能表現を避け、「〜と言われています／〜とされています」等の
     一般的な情報紹介の形に統一（診断・治療にあたる表現を避けるため）
   - 継続日数と年齢を参照する
   - 直近に出したものを避け、同じような内容が続かないようにする
   誕生日＋日付＋salt から決定的に生成するため、同じ日は同じ結果になり、
   「別のメッセージに切り替え」を押すと別の組み合わせが出る。

   姉妹アプリ（禁酒・禁煙）との大きな違いは、扱う害が体ではなく
   「お金・時間・人間関係」であること。したがって回復の説明も
   臓器の話ではなく、生活とお金の立て直しを軸にしている。 */

const ADVISOR_JA = {
  REC: {
    s0: [
      'ギャンブルをやめようと決めた、その決断そのものがいちばん大きな一歩です。今日はまず、財布とカードを自分の手の届かない場所に置いてみてください。',
      '始めた日は、気持ちよりも先に環境を変えるのが効くと言われています。アプリを消す、ブックマークを消す。それだけで衝動と自分の間に距離ができます。',
      'ギャンブルの問題は意志の強さの問題ではなく、相談できる問題だとされています。今日のうちに、誰か一人に打ち明ける相手を決めておくのもおすすめです。',
      '今日はまだ何も積み上がっていなくて当然です。「やらなかった1日」は明日には数字になります。今はそれだけで十分です。',
    ],
    s1: [
      '最初の数日は落ち着かなさやイライラが出やすい時期だと言われています。異常なことではなく、脳が刺激の少ない状態に慣れていく途中の反応とされています。',
      'この時期は「ちょっとだけなら」という考えが浮かびやすい頃です。浮かんだこと自体は止められません。浮かんでから動くまでの10分を稼ぐことが鍵になります。',
      '手持ち無沙汰な時間がいちばん危ないと言われています。今日はあらかじめ、夜の1〜2時間に何をするかを決めておきましょう。',
      '眠りにくい日があるかもしれません。多くの場合それは一時的です。強い不調が続くときは、我慢せず医療機関や相談窓口に相談してください。',
    ],
    s2: [
      'やりたい気持ちには「波」があり、山は10分ほどで越えていくことが多いと言われています。乗り越えるのではなく、やり過ごす感覚で大丈夫です。',
      '3日を越えると、ひとつのパターンが見えてきます。何時ごろ・どこで・どんな気分のときにやりたくなるか、メモに残しておくと後で効いてきます。',
      '「今日は何もできなかった」と感じる日もあると思います。それでもやらなかったのなら、その日は前に進んでいます。',
      '空いた時間の使い道が決まっていないと、元の習慣が戻ってきやすいと言われています。散歩でも家事でも、体を少し動かす予定が入っていると安定しやすくなります。',
    ],
    s3: [
      '1週間続けられたという事実は、これから先の自信の土台になります。ここまでの自分をきちんとねぎらってあげてください。',
      'この頃から、睡眠や集中の感じが変わってきたという人がいます。負けを気にして眠れない夜が減るだけでも、日中の余裕は変わってきます。',
      '1週間経ったら、お金の状況を一度だけ紙に書き出してみるのもおすすめです。見るのはつらい作業ですが、早く見るほど選べる方法は多く残ります。',
      '「もう大丈夫かも」と思えたら、それは回復の兆しであると同時に、少し注意したいサインでもあります。安全策は緩めずにおきましょう。',
    ],
    s4: [
      '2週間を超えると、生活のリズムが戻ってきたと感じる人が多いようです。決まった時間に寝て起きることが、衝動を弱める助けになるとされています。',
      'この時期は、お金の見通しを立て直すのに向いています。借入や返済で困っているときは、消費者ホットライン（188）や法テラスで相談先を案内してもらえます。',
      '周りの人との関係を少しずつ直していける時期でもあります。急いで全部を説明しなくて構いません。約束を1つ守ることから始まります。',
      'まだ「取り返せるのでは」という考えが浮かぶことがあります。浮かぶこと自体は自然です。行動に移さなければ、それはただの考えのままです。',
    ],
    s5: [
      '1か月を越えました。ここまで来ると、やらないことが少しずつ「普通」に近づいてきます。',
      'この頃から、使わずに済んだお金が実感できる額になってきます。使い道を先に決めておくと、その数字が「残高」ではなく「取り戻した暮らし」に見えてきます。',
      '自助グループ（GA）に一度だけ顔を出してみるのも、この時期に向いていると言われています。同じ経験をした人の話は、本を10冊読むより効くことがあります。',
      '調子がいいときこそ、安全策を1つ増やしておく好機です。うまくいっている理由は、自分の強さより仕組みにあることが多いからです。',
    ],
    s6: [
      '2か月を越えたあたりは、「もう自分はコントロールできる」と感じやすい時期だと言われています。この感覚が再開のいちばん多い入口です。',
      '長く離れているほど、たまにやる分には問題ない、という考えが説得力を持って聞こえてきます。それは回復が進んだ証拠であると同時に、注意したいサインでもあります。',
      'この時期に一度、最初に書いた「やめる理由」を読み返してみてください。書いた自分と、今の自分が話をする時間になります。',
      '調子がいい時期の記録は、あとで必ず役に立ちます。今のうちに「うまくいっている理由」を書き残しておきましょう。',
    ],
    s7: [
      '3か月続いています。ここまで来た人は、衝動が来ても行動に移さずにやり過ごす練習を、何度も重ねてきたということです。',
      '生活が落ち着いてくると、逆に引き金が見えにくくなることがあります。給料日、大きな出費、久しぶりの誘い。予定表に印を付けておくと備えやすくなります。',
      'お金の問題が残っている場合、この時期は落ち着いて向き合いやすいタイミングです。一人で抱えず、専門の窓口の力を借りてください。',
      '順調な時期ほど、記録が途切れがちになります。書くこと自体が、自分の状態を点検する時間になっています。',
    ],
    s8: [
      '半年です。ここまで続けられたことは、はっきりと大きな達成です。',
      'この時期には、生活の中でギャンブルが占めていた場所に、別のものが入ってきているはずです。それが何なのか、一度書き出してみてください。',
      '再発は珍しいことではなく、回復の過程の一部だとされています。もし戻ってしまっても、これまでの半年が消えるわけではありません。',
      '余裕が出てきたら、家族や大切な人が受けた影響にも目を向けられるかもしれません。家族向けの自助グループ（ギャマノン）もあります。',
    ],
    s9: [
      '1年を越えました。これは節目であると同時に、これまでの毎日の積み重ねそのものです。',
      '長く離れている人でも、引き金に触れれば衝動は戻ってくると言われています。それは失敗ではなく、そういう仕組みだというだけのことです。',
      'ここまでの経験は、同じところで困っている誰かにとって、とても具体的な助けになります。無理のない範囲で構いません。',
      '今日も、これまでと同じように一日を積みます。特別なことをしないことが、いちばん効く続け方です。',
    ],
  },

  AGE: {
    unknown: [
      '生年月日を設定に入れておくと、年代に合わせた内容もお届けできます（入力は任意です）。',
      '記録は日数だけでも十分に意味があります。数字が伸びていくこと自体が、行動の証拠になります。',
      '調子のいい日も、そうでない日も記録しておくと、あとで自分のパターンが見えてきます。',
      '無理のない範囲で続けるのがいちばんです。1日抜けても、その次の日から再開できます。',
    ],
    young: [
      '若い時期は回復の余地が大きい一方、オンラインのギャンブルは24時間手元にあるため、環境を変える工夫がとくに効きます。',
      'スマホから決済手段を外しておくだけでも、実際にやりにくくなると言われています。今日できる一手としておすすめです。',
      '友人との付き合いの中に誘いがある場合は、断り方をあらかじめ一つ決めておくと楽になります。',
      '早い時期に相談につながった人ほど、その後の選択肢が多く残るとされています。恥ずかしいことではありません。',
    ],
    a30: [
      '30代は収入も支出も動きやすい時期です。給料日や賞与の直後は、あらかじめ危ない日として印を付けておくと備えやすくなります。',
      '仕事のストレスがそのまま引き金になることがあります。帰り道のルートを変えるだけでも効果があると言われています。',
      'この年代は家族やパートナーへの影響が大きくなりがちです。早めに打ち明けた人ほど、関係を立て直しやすいとされています。',
      '将来の計画を立て直すのに向いた時期です。使わずに済んだお金の行き先を、具体的に決めてみてください。',
    ],
    a40: [
      '40代は責任も支出も重なりやすい時期です。一人で抱えず、お金の問題は専門の窓口に相談することをおすすめします。',
      '長く続いた習慣ほど、意志ではなく仕組みで止めるほうが確実だと言われています。安全策を1つずつ増やしていきましょう。',
      'この年代では、睡眠や血圧など体調の面でも余裕が戻ってきたと感じる人がいます。ストレスの元が1つ減るためと考えられています。',
      '子どもや家族に与える影響を心配されているなら、その気持ちはそのまま回復を支える力になります。',
    ],
    a50: [
      '50代は老後の資金設計に直結する時期です。今からでも立て直しは十分に可能で、早く動くほど選べる方法は多く残ります。',
      '退職金や大きな入金の前後は、とくに注意したい時期だと言われています。あらかじめ手をつけにくい形にしておきましょう。',
      '長い付き合いの習慣を変えるのは簡単ではありません。それでもここまで続けられているのは、確かな力です。',
      '同じ年代で回復した人は少なくありません。自助グループには、近い立場の人の話があります。',
    ],
    senior: [
      '年齢に関わらず、やめることの効果は得られるとされています。今日の一日も、確かに積み上がっています。',
      '時間に余裕がある時期は、空白がそのまま引き金になりやすいと言われています。予定を先に決めておくと安定しやすくなります。',
      '年金や貯蓄を守ることは、そのまま生活の安心につながります。困っているときは、遠慮なく公的な窓口を頼ってください。',
      '無理せず、自分のペースで。続けていること自体に価値があります。',
    ],
  },

  TRIVIA: [
    'ギャンブルの問題は「ギャンブル障害」として国際的な診断基準に位置づけられており、意志の弱さではなく治療や支援の対象とされています。',
    '「もう少しで当たりそう」という惜しい負け方（ニアミス）は、当たったときに近い反応を脳に起こすことが報告されています。演出として意図的に作られている場合もあります。',
    'いつ当たるか分からない形の報酬は、決まった間隔で得られる報酬よりも、行動が続きやすいことが古くから知られています。',
    '負けを取り返そうとして続けること（深追い）は、ギャンブル障害の診断基準に含まれる項目のひとつとされています。',
    '「そろそろ当たるはず」という感覚はギャンブラーの誤謬と呼ばれ、実際には過去の結果は次の結果に影響しないとされています。',
    '自分の技術や選び方で結果を変えられると感じることはコントロール幻想と呼ばれ、偶然に左右されるゲームでも起こりやすいとされています。',
    '公営競技やパチンコなどには、本人や家族の申し出で利用を制限できる仕組み（自己申告・家族申告プログラム）が用意されている場合があります。',
    'ギャンブルは仕組み上、長く続けるほど胴元側が有利になるように設計されています。取り返せるかどうかの問題ではなく、設計の問題だとされています。',
    '衝動は波のように来て引いていくもので、多くの場合その山は数十分以内に収まると言われています。',
    '自助グループ（GA）は全国でミーティングを開いており、匿名で参加できます。家族向けにはギャマノンがあります。',
    '借金の相談は、早い段階ほど選べる方法が多く残ると言われています。消費者ホットライン（188）から相談先を案内してもらえます。',
    '再発は回復の失敗ではなく、過程の一部として扱われることが多く、そこから何を学ぶかが次につながるとされています。',
    'ギャンブルの問題を抱える人では、気分の落ち込みや不安を併せ持つことがあると報告されています。つらさが続くときは相談を検討してください。',
    'お酒が入ると判断が緩みやすくなるため、飲酒とギャンブルが重なる場面は、とくに注意したい組み合わせだと言われています。',
    '「勝った記憶」は「負けた記憶」よりも思い出しやすいことが知られています。実際の収支と記憶がずれるのは、珍しいことではありません。',
    '広告や通知は、思い出すきっかけとして強く働きます。通知を切る・アプリを消すといった対処が推奨されています。',
    '一人でいる時間帯は再開が起きやすいと言われています。あらかじめ連絡できる相手を決めておくことが助けになります。',
    '記録を続けること自体が、自分の状態を客観的に見る練習になるとされています。',
  ],

  TIP: [
    '今日できることを1つだけ。ギャンブルのアプリを1つ消してみましょう。',
    '衝動が来たら、まず場所を変えてみてください。同じ部屋にいるより効果があると言われています。',
    '財布から現金を抜いて、家の取り出しにくい場所に置いてみましょう。',
    '「今つらい」とだけ、誰か一人に送ってみてください。説明はいりません。',
    '夜の予定を先に決めておくと、空白が引き金になりにくくなります。',
    '通知をオフにするだけでも、思い出す回数はかなり減ります。',
    '負けたあとの気持ちを思い出してみてください。勝った記憶より、そちらのほうが正確です。',
    'コップ一杯の水を飲んで、10分だけ待ってみましょう。',
    '通り道に施設があるなら、遠回りでも別のルートを試してみてください。',
    '今日の気分を記録しておくと、あとで自分のパターンが見えてきます。',
    'ネットバンキングの振込・出金の上限を下げておきましょう。',
    '3年後の自分が今の自分に何と言うか、少しだけ想像してみてください。',
    'カードを一枚、信頼できる人に預けてみるのも有効な手です。',
    '使わずに済んだお金の使い道を、具体的に1つ決めておきましょう。',
    '寝る前のスマホを少し早めに置くと、夜の衝動が弱まりやすくなります。',
    '一度だけ、収支を正直に書き出してみてください。見た人から強くなります。',
  ],

  CLOSING: [
    '今日も一日、お疲れさまでした。',
    '焦らず、比べず、一日ずつ。',
    '続けていること自体が、いちばんの結果です。',
    'うまくいかない日があっても、明日はまた始められます。',
    '一人で抱えなくて大丈夫です。',
    'ここまで来られたのは、偶然ではありません。',
    'やらなかった一日は、確かに数えられています。',
    '波は来ても、必ず引いていきます。',
    'ゆっくりで構いません。',
    '自分をねぎらう時間も、回復の一部です。',
    '今日の選択が、明日の自分を助けます。',
    '記録を残してくれてありがとうございます。',
  ],

  WORDS: [
    '「あと一回」は、いつも一回では終わりません。',
    '取り返そうとした時点で、負けはもう二倍になっています。',
    '勝った記憶は残りやすく、負けた記憶は消えやすい。だから数字を見ます。',
    'やめるのは意志の問題ではなく、環境の問題です。',
    '衝動は命令ではありません。ただの天気です。',
    '10分待てたなら、それはもう乗り切ったということです。',
    '今日やらなかったことは、誰にも見えなくても確かに起きています。',
    '減らすより、離れるほうが結局は楽だと言われています。',
    '手の届く場所にあるかどうかが、意志より効きます。',
    '「もう大丈夫」と思った日ほど、安全策を減らさないこと。',
    '打ち明けた相手の数だけ、戻りにくくなります。',
    '負けた金額より、失った時間のほうが大きいことがあります。',
    '一度の失敗で、これまでの日数が消えるわけではありません。',
    '数えているのは連続日数だけではなく、通算の日数もです。',
    '相談は、追い込まれてからより、余裕があるうちのほうが効きます。',
    '仕組みで勝てないものに、努力で勝とうとしなくていい。',
    '暇な時間は、いちばん高くつく時間かもしれません。',
    '通り道を変えるだけで、選ばずに済むことがあります。',
    '「今日はやらない」だけを決めれば十分です。',
    '記録は自分を責めるためではなく、自分を助けるためにあります。',
    '一人でやめようとしなくていい。それは根性の話ではありません。',
    '静かな一日は、退屈ではなく回復です。',
    'お金が減らない日は、それだけで良い日です。',
    '「取り返す」以外の出口が、いつもあります。',
    '波が高い日は、決断せずにやり過ごすのが正解です。',
    '昨日の自分が我慢したから、今日の自分がここにいます。',
    '誰にも言えないと感じたときこそ、窓口があります。',
    '広告は、あなたの弱さではなく設計を狙っています。',
    'やめた日数より、やめ続けている今日のほうが大事です。',
    '完璧でなくていい。続いていればそれでいい。',
  ],

  ageLabel(age) { return age == null ? '' : `${age}歳`; },
  triviaLabel: '📎 ',
  head(days, label) {
    const who = label ? `${label}のあなたへ。` : '';
    if (days <= 0) return `${who}今日から始まります。`;
    if (days === 1) return `${who}やらない日が1日目です。`;
    return `${who}やらない日が${days}日続いています。`;
  },
};

const ADVISOR_EN = {
  REC: {
    s0: [
      'Deciding to stop is the single biggest step. Today, try putting your wallet and cards somewhere out of reach.',
      'On day one, changing your surroundings works better than changing how you feel. Delete the apps and the bookmarks — that alone puts distance between you and the urge.',
      'Gambling problems are treated as something you can get help with, not a failure of willpower. Pick one person you could tell.',
      'Nothing has accumulated yet, and that’s normal. A day you didn’t gamble becomes a number tomorrow.',
    ],
    s1: [
      'Restlessness and irritability are common in the first days. It isn’t a sign something is wrong — it’s your brain adjusting to less stimulation.',
      '“Just once” tends to show up around now. You can’t stop the thought arriving. What you can do is buy ten minutes before you act.',
      'Empty time is the risky part. Decide today what the next couple of evening hours will hold.',
      'Sleep may be uneven for a while. It’s usually temporary — but if it persists or feels severe, please talk to a professional.',
    ],
    s2: [
      'Urges come in waves, and the peak usually passes within about ten minutes. You don’t have to beat it — just outlast it.',
      'After a few days, a pattern starts to show. Note the time, place and mood when the urge hits; it pays off later.',
      'Some days will feel like nothing happened. If you didn’t gamble, something did.',
      'If the freed-up time has no plan, the old habit fills it. Anything that moves your body helps.',
    ],
    s3: [
      'A week is a real foundation for the confidence that comes next. Give yourself proper credit.',
      'Around now, some people notice sleep and focus shifting. Fewer nights spent replaying losses changes the next day.',
      'A week in is a good moment to write your finances down once. It’s a hard hour, and it leaves you more options.',
      '“Maybe I’m fine now” is both a sign of progress and a moment to be careful. Keep your safeguards in place.',
    ],
    s4: [
      'Past two weeks, daily rhythm often starts to return. Consistent sleep is thought to make urges weaker.',
      'This is a good time to rebuild a financial picture. If debt is a problem, a consumer or legal helpline can point you to the right service.',
      'Relationships can start to mend now. You don’t have to explain everything at once — it starts with keeping one promise.',
      '“I could win it back” may still surface. The thought is normal. Left unacted on, it stays just a thought.',
    ],
    s5: [
      'Past a month. Not gambling is slowly becoming ordinary.',
      'The money not spent is becoming a real figure. Decide what it’s for and it stops being a balance and starts being a life.',
      'Now is a good time to attend one peer support meeting. Hearing someone with the same history can land harder than any book.',
      'Good stretches are the best time to add one more safeguard. What’s working is usually the setup, not your strength.',
    ],
    s6: [
      'Around two months, “I can control this now” tends to appear. That feeling is the most common doorway back.',
      'The longer you’ve been away, the more reasonable “occasionally is fine” starts to sound. That’s progress and a warning at once.',
      'Re-read the reasons you wrote at the start. It’s a conversation between the you who wrote them and the you today.',
      'Write down why things are going well. That note will be useful later.',
    ],
    s7: [
      'Three months in. You’ve practised letting urges pass without acting, over and over.',
      'When life settles, triggers get harder to see. Payday, a big expense, an old invitation — mark them on a calendar.',
      'If money problems remain, this is a calmer moment to face them. Use the services; don’t carry it alone.',
      'Logging tends to lapse when things go well. The writing itself is how you check your own state.',
    ],
    s8: [
      'Six months. That is unambiguously a big achievement.',
      'Something has moved into the space gambling used to occupy. Try writing down what it is.',
      'Relapse is common and treated as part of recovery. If it happens, the six months don’t disappear.',
      'With more room, you may be able to look at how this affected the people close to you. There are family support groups too.',
    ],
    s9: [
      'Past a year — a milestone, and also just the sum of your days.',
      'Even after a long time, urges can return when you meet a trigger. That’s not failure; that’s how it works.',
      'What you’ve learned can be very concrete help to someone else stuck where you were. Only if and when you want to.',
      'Today you add another ordinary day. Doing nothing special is the most effective way to continue.',
    ],
  },

  AGE: {
    unknown: [
      'Add your birth date in settings and messages can match your age group (entirely optional).',
      'The day count alone is meaningful. A rising number is evidence of what you did.',
      'Log the good days and the hard ones — patterns show up later.',
      'Sustainable beats perfect. Miss a day and you can pick it up the next.',
    ],
    young: [
      'Recovery has plenty of room at your age, but online gambling is in your hand around the clock — changing the environment matters most.',
      'Removing payment methods from your phone genuinely makes it harder. It’s a good move for today.',
      'If invitations come through friends, decide your one standard way of saying no in advance.',
      'People who reach out early tend to keep more options open. There’s nothing embarrassing about it.',
    ],
    a30: [
      'Income and outgoings move a lot in your thirties. Mark payday and bonus days as high-risk in advance.',
      'Work stress often becomes the trigger directly. Even changing your route home helps.',
      'The impact on partners and family grows at this stage. People who tell someone early find it easier to repair things.',
      'It’s a good time to rebuild plans. Decide concretely where the unspent money is going.',
    ],
    a40: [
      'Responsibilities and expenses stack up in your forties. Don’t carry money problems alone — use the specialist services.',
      'The longer a habit has run, the more reliably structure beats willpower. Add safeguards one at a time.',
      'Some people notice sleep and blood pressure easing, likely because one large stressor is gone.',
      'If you worry about the effect on your children or family, that concern itself supports your recovery.',
    ],
    a50: [
      'Your fifties tie directly into retirement planning. Rebuilding is still very possible, and moving early keeps more options.',
      'The period around a lump sum or retirement payout deserves extra care. Make it hard to reach in advance.',
      'Changing a long-standing habit isn’t simple. That you’ve come this far is real strength.',
      'Plenty of people recover at this age. Peer meetings have others in a similar position.',
    ],
    senior: [
      'The benefits of stopping are available at any age. Today counts just as much.',
      'When there is free time, empty hours themselves become the trigger. Deciding plans in advance steadies things.',
      'Protecting your pension and savings is protecting your peace of mind. Lean on public services when you need to.',
      'At your own pace. Continuing is the value.',
    ],
  },

  TRIVIA: [
    'Gambling problems are recognised in international diagnostic manuals as a disorder — something to be supported and treated, not a lack of willpower.',
    'A “near miss” produces a response in the brain close to a win, and in some products it is designed in deliberately.',
    'Rewards that arrive unpredictably sustain behaviour far more strongly than rewards on a fixed schedule — a long-established finding.',
    'Chasing losses is one of the listed criteria used to identify gambling disorder.',
    'The sense that a win is “due” is called the gambler’s fallacy; past outcomes do not influence the next one.',
    'Feeling your skill or choices change the result is called the illusion of control, and it appears even in games of pure chance.',
    'Many operators run self-exclusion schemes that let you, or your family, restrict your own access.',
    'Gambling is structured so the operator gains over time. It isn’t a question of whether you can win it back — it’s the design.',
    'Urges rise and fall like waves, and the peak usually settles within tens of minutes.',
    'Peer support groups meet across the country and can be attended anonymously. There are family groups too.',
    'Advice on debt keeps more options open the earlier it is sought.',
    'Relapse is generally treated as part of the recovery process rather than its failure — what you learn from it is what carries forward.',
    'Low mood and anxiety are reported alongside gambling problems. If distress persists, consider reaching out.',
    'Alcohol loosens judgement, so drinking and gambling together is a combination worth avoiding.',
    'Wins are easier to recall than losses. It is very common for memory and the actual balance to disagree.',
    'Ads and push notifications work as reminders. Turning them off and deleting the apps is standard advice.',
    'Time spent alone is when returns most often happen. Deciding in advance who you can contact helps.',
    'Keeping records is itself practice in seeing your own state objectively.',
  ],

  TIP: [
    'One thing today: delete one gambling app.',
    'When the urge comes, change rooms first. It works better than staying put.',
    'Take the cash out of your wallet and put it somewhere awkward to reach.',
    'Send one person the words “having a hard time”. No explanation needed.',
    'Plan your evening in advance so the empty hours don’t do it for you.',
    'Turning off notifications alone cuts how often it crosses your mind.',
    'Recall how you felt after a loss. That memory is the accurate one.',
    'Drink a glass of water and wait ten minutes.',
    'If a venue is on your route, try the longer way instead.',
    'Log today’s mood — the pattern shows up later.',
    'Lower your online banking transfer and withdrawal limits.',
    'Picture what you three years from now would say to you today.',
    'Hand one card to someone you trust.',
    'Decide one concrete thing the unspent money is for.',
    'Put the phone down earlier at night; late urges tend to weaken.',
    'Write your finances down honestly, once. You get stronger from having looked.',
  ],

  CLOSING: [
    'Well done today.',
    'No rush, no comparing. One day at a time.',
    'Continuing is itself the result.',
    'A bad day doesn’t stop tomorrow from starting.',
    'You don’t have to carry this alone.',
    'Getting here wasn’t an accident.',
    'A day you didn’t gamble is counted.',
    'The wave comes, and the wave goes.',
    'Slow is fine.',
    'Being kind to yourself is part of recovery.',
    'Today’s choice helps tomorrow’s you.',
    'Thank you for keeping the record.',
  ],

  WORDS: [
    '“One more” is never one more.',
    'The moment you chase it, the loss has already doubled.',
    'Wins stick in memory and losses fade. That’s why we look at the number.',
    'Stopping is a question of environment, not willpower.',
    'An urge is not an order. It’s weather.',
    'If you waited ten minutes, you already rode it out.',
    'What you didn’t do today happened, even if nobody saw it.',
    'Stepping away is usually easier than cutting down.',
    'Whether it’s within reach matters more than how you feel.',
    'The day you think “I’m fine now” is the day to keep your safeguards.',
    'Every person you tell makes going back harder.',
    'The time lost can be larger than the money.',
    'One slip does not erase the days behind it.',
    'We count the total days, not only the streak.',
    'Asking for help works better before you’re cornered.',
    'You don’t have to out-effort a system built to win.',
    'Empty time may be the most expensive time.',
    'Change the route and you never have to choose.',
    'Deciding “not today” is enough.',
    'Records exist to help you, not to blame you.',
    'You don’t have to stop alone. That isn’t about grit.',
    'A quiet day isn’t boredom. It’s recovery.',
    'A day your money didn’t shrink is a good day.',
    'There is always an exit other than “win it back”.',
    'On high-wave days, the right move is to decide nothing.',
    'Yesterday’s you held on, so today’s you is here.',
    'When you feel you can’t tell anyone, that’s what the helplines are for.',
    'The ads target the design, not your weakness.',
    'Today matters more than the total.',
    'It doesn’t have to be perfect. It has to continue.',
  ],

  ageLabel(age) { return age == null ? '' : `${age}`; },
  triviaLabel: '📎 ',
  head(days, label) {
    const who = label ? `At ${label}: ` : '';
    if (days <= 0) return `${who}it starts today.`;
    if (days === 1) return `${who}day 1 without gambling.`;
    return `${who}${days} days without gambling.`;
  },
};

function stageKey(days) {
  if (days <= 0) return 's0';
  if (days <= 2) return 's1';
  if (days <= 6) return 's2';
  if (days <= 13) return 's3';
  if (days <= 29) return 's4';
  if (days <= 59) return 's5';
  if (days <= 89) return 's6';
  if (days <= 179) return 's7';
  if (days <= 364) return 's8';
  return 's9';
}

function ageGroup(age) {
  if (age == null) return 'unknown';
  if (age < 30) return 'young';
  if (age < 40) return 'a30';
  if (age < 50) return 'a40';
  if (age < 60) return 'a50';
  return 'senior';
}

/* 直近に使ったものを避けて選ぶ */
function pick(pool, rand, history, keep) {
  let avail = pool.filter(s => !history.includes(s));
  if (avail.length === 0) avail = pool.slice();
  const s = avail[Math.floor(rand() * avail.length)];
  history.push(s);
  while (history.length > keep) history.shift();
  return s;
}

function ageFrom(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate), t = new Date();
  if (isNaN(b)) return null;
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return (a >= 0 && a < 130) ? a : null;
}

/* history はステップ別の配列を持つオブジェクト（永続化される）。破壊的に更新する。 */
function generate({ days, age, date, salt = 0, history, lang = 'ja' }) {
  const C = lang === 'en' ? ADVISOR_EN : ADVISOR_JA;
  history = history || {};
  for (const k of ['rec', 'age', 'trivia', 'tip', 'closing']) if (!history[k]) history[k] = [];

  const rand = Util.rng(Util.hashSeed(`${date}|${salt}|${age == null ? 'x' : age}|${days}`));
  const grp = ageGroup(age);
  const label = C.ageLabel(age);

  /* keepは各プールのサイズより少なめにする（同じ数だと「直近を除外」が
     常に空振りしてフォールバックし続け、実質ただの毎回コインフリップになるため） */
  const rec = pick(C.REC[stageKey(days)], rand, history.rec, 2);      // 各stageのプールは4件
  const ageNote = pick(C.AGE[grp], rand, history.age, 3);             // 各グループ4件
  const trivia = pick(C.TRIVIA, rand, history.trivia, 10);            // 全18件
  const tip = pick(C.TIP, rand, history.tip, 8);                      // 全16件
  const closing = pick(C.CLOSING, rand, history.closing, 6);          // 全12件

  const text =
    `${C.head(days, label)}\n\n` +
    `🕊️ ${rec}\n\n` +
    `${ageNote}\n\n` +
    `${C.triviaLabel}${trivia}\n\n` +
    `${tip} ${closing}`;

  return { text };
}

/* 「今日のひとこと」。日付だけから決まるため、同じ日に何度開いても内容は変わらない。
   姉妹アプリのタロットのような「引き直し」「レア度」は、変動報酬そのもので
   ギャンブルの仕組みと同じになってしまうため、このアプリでは意図的に持たせていない。 */
function todayWord(date, lang = 'ja') {
  const pool = (lang === 'en' ? ADVISOR_EN : ADVISOR_JA).WORDS;
  return pool[Util.hashSeed('word|' + date) % pool.length];
}

window.Advisor = { generate, ageFrom, todayWord };
