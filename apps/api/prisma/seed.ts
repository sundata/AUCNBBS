import { PrismaClient } from '@prisma/client';
import { DEFAULT_LISTING_TTL_DAYS } from '@aucn/domain';

const prisma = new PrismaClient();

// Deterministic UUIDs so the seed is idempotent and fixtures are stable across environments.
const ids = {
  city: {
    sydney: '00000000-0000-4000-8000-000000000101',
    melbourne: '00000000-0000-4000-8000-000000000102',
    brisbane: '00000000-0000-4000-8000-000000000103',
    perth: '00000000-0000-4000-8000-000000000104',
    adelaide: '00000000-0000-4000-8000-000000000105',
    canberra: '00000000-0000-4000-8000-000000000106',
  },
  user: {
    editor: '00000000-0000-4000-8000-000000000201',
    alice: '00000000-0000-4000-8000-000000000202',
    bob: '00000000-0000-4000-8000-000000000203',
  },
  board: {
    newcomer: '00000000-0000-4000-8000-000000000301',
    life: '00000000-0000-4000-8000-000000000302',
    study: '00000000-0000-4000-8000-000000000303',
    career: '00000000-0000-4000-8000-000000000304',
    visa: '00000000-0000-4000-8000-000000000305',
    property: '00000000-0000-4000-8000-000000000306',
    food: '00000000-0000-4000-8000-000000000307',
    qa: '00000000-0000-4000-8000-000000000308',
  },
};

const cities = [
  {
    id: ids.city.sydney,
    slug: 'sydney',
    state: 'NSW',
    nameZh: '悉尼',
    nameEn: 'Sydney',
    timezone: 'Australia/Sydney',
    isLaunch: true,
    sortOrder: 1,
  },
  {
    id: ids.city.melbourne,
    slug: 'melbourne',
    state: 'VIC',
    nameZh: '墨尔本',
    nameEn: 'Melbourne',
    timezone: 'Australia/Melbourne',
    isLaunch: true,
    sortOrder: 2,
  },
  {
    id: ids.city.brisbane,
    slug: 'brisbane',
    state: 'QLD',
    nameZh: '布里斯班',
    nameEn: 'Brisbane',
    timezone: 'Australia/Brisbane',
    isLaunch: true,
    sortOrder: 3,
  },
  {
    id: ids.city.perth,
    slug: 'perth',
    state: 'WA',
    nameZh: '珀斯',
    nameEn: 'Perth',
    timezone: 'Australia/Perth',
    isLaunch: false,
    sortOrder: 4,
  },
  {
    id: ids.city.adelaide,
    slug: 'adelaide',
    state: 'SA',
    nameZh: '阿德莱德',
    nameEn: 'Adelaide',
    timezone: 'Australia/Adelaide',
    isLaunch: false,
    sortOrder: 5,
  },
  {
    id: ids.city.canberra,
    slug: 'canberra',
    state: 'ACT',
    nameZh: '堪培拉',
    nameEn: 'Canberra',
    timezone: 'Australia/Sydney',
    isLaunch: false,
    sortOrder: 6,
  },
];

const boards = [
  {
    id: ids.board.newcomer,
    slug: 'newcomer',
    nameZh: '新人报到',
    nameEn: 'Newcomers',
    descriptionZh: '刚到澳洲？先来打个招呼，领取落地清单。',
    descriptionEn: 'Just landed? Say hi and grab the arrival checklist.',
    sortOrder: 1,
  },
  {
    id: ids.board.life,
    slug: 'life',
    nameZh: '生活闲聊',
    nameEn: 'Daily Life',
    descriptionZh: '衣食住行、吐槽与分享。',
    descriptionEn: 'Everyday life, rants and tips.',
    sortOrder: 2,
  },
  {
    id: ids.board.study,
    slug: 'study',
    nameZh: '留学求学',
    nameEn: 'Study',
    descriptionZh: '选校、签证、课程与校园生活。',
    descriptionEn: 'Schools, courses and campus life.',
    sortOrder: 3,
  },
  {
    id: ids.board.career,
    slug: 'career',
    nameZh: '职场求职',
    nameEn: 'Careers',
    descriptionZh: '求职经验、职场话题、薪资讨论。',
    descriptionEn: 'Job hunting, workplace and salary talk.',
    sortOrder: 4,
  },
  {
    id: ids.board.visa,
    slug: 'visa',
    nameZh: '签证移民',
    nameEn: 'Visa & Migration',
    descriptionZh: '经验分享，不构成法律建议。',
    descriptionEn: 'Community experience only — not legal advice.',
    sortOrder: 5,
  },
  {
    id: ids.board.property,
    slug: 'property',
    nameZh: '房产置业',
    nameEn: 'Property',
    descriptionZh: '买房、贷款、租房经验。',
    descriptionEn: 'Buying, mortgages and renting experience.',
    sortOrder: 6,
  },
  {
    id: ids.board.food,
    slug: 'food',
    nameZh: '美食探店',
    nameEn: 'Food',
    descriptionZh: '哪家好吃？',
    descriptionEn: 'Where to eat?',
    sortOrder: 7,
  },
  {
    id: ids.board.qa,
    slug: 'qa',
    nameZh: '问答互助',
    nameEn: 'Q&A',
    descriptionZh: '提问求助，互帮互助。',
    descriptionEn: 'Ask and help each other.',
    sortOrder: 8,
  },
];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function main(): Promise<void> {
  for (const city of cities) {
    await prisma.city.upsert({ where: { id: city.id }, update: city, create: city });
  }
  for (const board of boards) {
    await prisma.board.upsert({ where: { id: board.id }, update: board, create: board });
  }

  const users = [
    {
      id: ids.user.editor,
      displayName: '小圈编辑部',
      role: 'editor' as const,
      homeCityId: ids.city.sydney,
      email: 'editor@example.com',
    },
    {
      id: ids.user.alice,
      displayName: 'Alice 在悉尼',
      role: 'member' as const,
      homeCityId: ids.city.sydney,
      email: 'alice@example.com',
    },
    {
      id: ids.user.bob,
      displayName: 'Bob Melb',
      role: 'member' as const,
      homeCityId: ids.city.melbourne,
      email: 'bob@example.com',
    },
  ];
  for (const { email, ...u } of users) {
    await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
    await prisma.identity.upsert({
      where: {
        provider_providerAppId_providerSubject: {
          provider: 'email_otp',
          providerAppId: '',
          providerSubject: email,
        },
      },
      update: {},
      create: {
        userId: u.id,
        provider: 'email_otp',
        providerSubject: email,
        verifiedAt: new Date(),
      },
    });
  }

  const articles = [
    {
      slug: 'welcome-aucn-hub',
      category: 'platform',
      title: '欢迎来到澳中生活圈',
      summary: '一个为在澳华人打造的资讯、社区与本地信息平台。',
      body: '澳中生活圈（AUCN Hub）现已开放公测。你可以在这里浏览城市资讯、参与社区讨论、发布租房/招聘/二手/服务信息。\n\n本平台不代表任何政府或法律机构，涉及签证、税务、医疗等内容仅供参考。',
    },
    {
      slug: 'sydney-rental-guide-2026',
      category: 'housing',
      title: '悉尼租房入门：看房、签约与押金那些事',
      summary: '从 inspection 到 bond 退还，一篇讲清悉尼租房流程。',
      body: '第一次在悉尼租房，最常见的问题是押金（bond）和租约（lease）。在新州，押金必须存入 NSW Fair Trading 的 Rental Bonds Online……\n\n免责声明：本文为经验分享，不构成法律建议。',
    },
    {
      slug: 'melbourne-job-market-note',
      category: 'career',
      title: '墨尔本本地就业观察：餐饮零售需求回暖',
      summary: '社区贡献者整理的近期招聘趋势。',
      body: '据社区招聘板块统计，近一个月餐饮、零售兼职岗位发布量明显上升……',
    },
    {
      slug: 'brisbane-weekend-markets',
      category: 'life',
      title: '布里斯班周末市集地图',
      summary: '周末去哪儿？本地华人常逛的几个市集。',
      body: 'West End Markets、Eat Street Northshore……',
    },
  ];
  for (const a of articles) {
    await prisma.article.upsert({
      where: { slug: a.slug },
      update: { ...a, status: 'published', publishedAt: new Date('2026-08-30T00:00:00Z') },
      create: {
        ...a,
        authorId: ids.user.editor,
        status: 'published',
        publishedAt: new Date('2026-08-30T00:00:00Z'),
      },
    });
  }

  await prisma.comment.deleteMany({
    where: { post: { author: { id: { in: [ids.user.alice, ids.user.bob] } } } },
  });
  await prisma.post.deleteMany({ where: { authorId: { in: [ids.user.alice, ids.user.bob] } } });
  const post1 = await prisma.post.create({
    data: {
      boardId: ids.board.newcomer,
      authorId: ids.user.alice,
      cityId: ids.city.sydney,
      title: '刚落地悉尼，办银行卡和税号的顺序是什么？',
      body: '下周一到悉尼，想先把银行卡、TFN、手机卡办好，大家一般什么顺序？',
      type: 'question',
    },
  });
  await prisma.comment.create({
    data: {
      postId: post1.id,
      authorId: ids.user.bob,
      body: '先办手机卡（要收验证码），然后银行卡，TFN 在 ATO 网站在线申请就行。',
    },
  });
  await prisma.post.update({ where: { id: post1.id }, data: { commentCount: 1 } });
  await prisma.post.create({
    data: {
      boardId: ids.board.food,
      authorId: ids.user.bob,
      cityId: ids.city.melbourne,
      title: '墨尔本 Box Hill 新开的川菜馆有人试过吗',
      body: '路过看到排队很长，想问问口味如何。',
    },
  });

  await prisma.listing.deleteMany({ where: { ownerId: { in: [ids.user.alice, ids.user.bob] } } });
  await prisma.listing.create({
    data: {
      ownerId: ids.user.alice,
      type: 'housing',
      intent: 'offer',
      status: 'active',
      cityId: ids.city.sydney,
      title: 'Burwood 两房一卫整租，近火车站',
      body: '步行 5 分钟到 Burwood 站，带车位，可养猫。',
      priceMinor: 75000,
      publishedAt: new Date(),
      expiresAt: daysFromNow(DEFAULT_LISTING_TTL_DAYS.housing),
      housing: {
        create: {
          kind: 'whole',
          propertyType: 'apartment',
          rentPeriod: 'week',
          bondMinor: 300000,
          bedrooms: 2,
          bathrooms: 1,
          parking: 1,
          suburb: 'Burwood',
          postcode: '2134',
          petsAllowed: true,
        },
      },
    },
  });
  await prisma.listing.create({
    data: {
      ownerId: ids.user.bob,
      type: 'housing',
      intent: 'wanted',
      status: 'active',
      cityId: ids.city.melbourne,
      title: '求租 CBD 附近单间，预算 A$350/周',
      body: '学生，不抽烟，3 月入住。',
      priceMinor: 35000,
      publishedAt: new Date(),
      expiresAt: daysFromNow(DEFAULT_LISTING_TTL_DAYS.housing),
      housing: {
        create: {
          kind: 'share',
          propertyType: 'apartment',
          rentPeriod: 'week',
          bedrooms: 1,
          bathrooms: 1,
          suburb: 'Melbourne',
        },
      },
    },
  });
  await prisma.listing.create({
    data: {
      ownerId: ids.user.bob,
      type: 'job',
      intent: 'offer',
      status: 'active',
      cityId: ids.city.melbourne,
      title: '中餐厅招全职/兼职服务员',
      body: '需中英双语，有工作权利，周末可上班。',
      publishedAt: new Date(),
      expiresAt: daysFromNow(DEFAULT_LISTING_TTL_DAYS.job),
      job: {
        create: {
          companyName: '示例餐饮集团',
          employmentType: 'casual',
          industry: 'hospitality',
          salaryMinMinor: 2500,
          salaryMaxMinor: 3000,
          salaryPeriod: 'hour',
          workRightsRequired: 'any_work_rights',
          suburb: 'Box Hill',
        },
      },
    },
  });
  await prisma.listing.create({
    data: {
      ownerId: ids.user.alice,
      type: 'item',
      intent: 'offer',
      status: 'active',
      cityId: ids.city.sydney,
      title: '搬家出 IKEA 书桌 + 椅子',
      body: '用了一年，九成新，自取。',
      priceMinor: 8000,
      publishedAt: new Date(),
      expiresAt: daysFromNow(DEFAULT_LISTING_TTL_DAYS.item),
      item: {
        create: {
          category: 'furniture',
          condition: 'like_new',
          brand: 'IKEA',
          negotiable: true,
          deliveryMethods: ['pickup'],
          suburb: 'Burwood',
        },
      },
    },
  });
  await prisma.listing.create({
    data: {
      ownerId: ids.user.bob,
      type: 'service',
      intent: 'offer',
      status: 'active',
      cityId: ids.city.brisbane,
      title: '布里斯班机场接送 / 搬家小货车',
      body: '7 座商务车，持商业保险，可开发票。',
      priceMinor: 6000,
      publishedAt: new Date(),
      expiresAt: daysFromNow(DEFAULT_LISTING_TTL_DAYS.service),
      service: {
        create: {
          category: 'moving',
          priceMode: 'from',
          serviceArea: 'Brisbane metro',
          isBusiness: true,
        },
      },
    },
  });
  // Expired listing: must never appear in public lists/search.
  await prisma.listing.create({
    data: {
      ownerId: ids.user.alice,
      type: 'item',
      intent: 'offer',
      status: 'active',
      cityId: ids.city.sydney,
      title: '（已过期）二手自行车',
      body: '这个 listing 用来验证过期过滤。',
      priceMinor: 5000,
      publishedAt: daysFromNow(-60),
      expiresAt: daysFromNow(-1),
      item: {
        create: {
          category: 'sports',
          condition: 'good',
          deliveryMethods: ['pickup'],
          suburb: 'Ashfield',
        },
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
