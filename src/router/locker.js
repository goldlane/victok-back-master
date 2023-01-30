import dayjs from 'dayjs';
import express from 'express';
import { body, query } from 'express-validator';
import { db } from '../db/database.js';
import { isAuth, validate } from '../middleware/functions.js';

const router = express.Router();

// 라커 구분 등록
router.post(
  '/locker-type',
  isAuth,
  [
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_amount').trim().notEmpty().withMessage('라커 개수를 입력해 주세요.'),
    body('start_number').trim().notEmpty().withMessage('시작 번호를 입력해 주세요.'),
    body('talk_dday').isLength({ min: 1 }).withMessage('알림주기를 설정해 주세요.'),
    body('charge').isLength({ min: 1 }).withMessage('요금제를 등록해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_type, locker_amount, start_number, charge, talk_dday } = req.body;
    console.log('데이터', locker_type, locker_amount, start_number, charge, talk_dday);
    const foundType = await db
      .execute(`SELECT idx FROM locker_type WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&deleted_time IS NULL`)
      .then((result) => result[0][0]);
    console.log('foundType', foundType);
    if (foundType) {
      res.status(409).json({ message: '라커 구분명이 중복됩니다.' });
    } else {
      const result = await db.execute(
        'INSERT INTO locker_type (user_idx, locker_type, locker_amount, start_number, created_time) VALUES (?,?,?,?,?)',
        [req.authorizedUser, locker_type, locker_amount, start_number, new Date()]
      );
      console.log('리턴', result[0].insertId);
      const insertId = result[0].insertId;
      for (const i of charge) {
        console.log(i);
        await db.execute('INSERT INTO charge (locker_type_idx, period_type, period, charge, deposit) VALUES (?,?,?,?,?)', [
          insertId,
          Number(i.period_type),
          Number(i.period),
          Number(i.charge),
          Number(i.deposit),
        ]);
      }
      for (const i of talk_dday) {
        console.log(i);
        await db.execute('INSERT INTO talk_dday (user_idx, locker_type_idx, dday) VALUES (?,?,?)', [req.authorizedUser, insertId, Number(i)]);
      }
      res.sendStatus(201);
    }
  }
);

// 라커 구분 수정
router.put(
  '/locker-type',
  isAuth,
  [
    body('locker_type_idx').trim().notEmpty().withMessage('라커 타입 idx를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_amount').trim().notEmpty().withMessage('라커 개수를 입력해 주세요.'),
    body('start_number').trim().notEmpty().withMessage('시작 번호를 입력해 주세요.'),
    body('talk_dday').isLength({ min: 1 }).withMessage('알림주기를 설정해 주세요.'),
    body('charge').isLength({ min: 1 }).withMessage('요금제를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_type_idx, locker_type, locker_amount, start_number, charge, talk_dday } = req.body;
    const foundType = await db
      .execute(
        `SELECT * FROM locker_type WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&idx!=${locker_type_idx}&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    if (foundType && foundType.locker_type !== locker_type) {
      res.status(409).json({ message: '라커 구분명이 중복됩니다.' });
    } else {
      const beforeType = await db.execute(`SELECT * FROM locker_type WHERE idx=${locker_type_idx}`).then((result) => result[0][0]);
      const foundCustomer = await db
        .execute(
          `SELECT * FROM locker WHERE user_idx=${req.authorizedUser}&&deleted_time IS NULL&&(locker_number<${start_number}||locker_number>(${start_number}+${locker_amount}-1))&&locker_type='${beforeType.locker_type}'`
        )
        .then((result) => result[0][0]);
      if (foundCustomer) {
        console.log(foundCustomer);
        return res.status(409).json({ message: '설정한 라커번호 범위 내에서 벗어나는 고객이 등록되어 있습니다.' });
      }
      await db.execute('UPDATE locker_type SET locker_type=?, locker_amount=?, start_number=?, updated_time=? WHERE idx=?', [
        locker_type,
        locker_amount,
        start_number,
        new Date(),
        locker_type_idx,
      ]);
      await db.execute('UPDATE locker SET locker_type=? WHERE user_idx=? && locker_type=? && deleted_time IS NULL', [
        locker_type,
        req.authorizedUser,
        beforeType.locker_type,
      ]);
      await db.execute('UPDATE charge SET deleted_time=? WHERE locker_type_idx=?', [new Date(), locker_type_idx]);
      for (const i of charge) {
        console.log(i);
        await db.execute('INSERT INTO charge (locker_type_idx, period_type, period, charge, deposit) VALUES (?,?,?,?,?)', [
          locker_type_idx,
          Number(i.period_type),
          Number(i.period),
          Number(i.charge),
          Number(i.deposit),
        ]);
      }
      await db.execute('UPDATE talk_dday SET deleted_time=? WHERE locker_type_idx=?', [new Date(), locker_type_idx]);
      for (const i of talk_dday) {
        console.log(i);
        await db.execute('INSERT INTO talk_dday (user_idx, locker_type_idx, dday) VALUES (?,?,?)', [req.authorizedUser, locker_type_idx, Number(i)]);
      }
      res.sendStatus(201);
    }
  }
);

// 라커 구분 목록 - 요금표 포함
router.get('/locker-type', isAuth, async (req, res) => {
  const { page } = req.query;
  const amount = req.query.amount ?? 10;
  const total = await db
    .execute(`SELECT COUNT(idx) AS total FROM locker_type WHERE user_idx=${req.authorizedUser}&&deleted_time IS NULL`)
    .then((result) => result[0][0].total);
  const list = await db
    .execute(
      `SELECT locker_type.idx as idx,locker_type.locker_type as locker_type,locker_type.start_number as start_number,locker_type.locker_amount as locker_amount, group_concat(DISTINCT talk_dday.dday) as dday FROM locker_type LEFT JOIN talk_dday ON locker_type.idx=talk_dday.locker_type_idx  WHERE talk_dday.deleted_time IS NULL&&locker_type.user_idx=${
        req.authorizedUser
      }&&locker_type.deleted_time IS NULL GROUP BY locker_type.idx ORDER BY idx LIMIT ${amount} OFFSET ${amount * (page - 1)}`
    )
    .then((result) => result[0]);
  console.log(list);
  const chargeList = await Promise.all(
    list.map(async (item) => {
      const charge = await db
        .execute(`SELECT idx, period, charge, deposit,period_type FROM charge WHERE locker_type_idx=${item.idx}&&deleted_time IS NULL`)
        .then((result) => result[0]);
      return { ...item, charge: charge };
    })
  );
  console.log(chargeList);
  res.status(200).json({ total, chargeList });
});

// 라커 구분 목록 - 요금표 포함 (페이지네이션 없는 것)
router.get('/locker-type-all', isAuth, async (req, res) => {
  const list = await db
    .execute(`SELECT * FROM locker_type WHERE user_idx=${req.authorizedUser}&&deleted_time IS NULL ORDER BY idx`)
    .then((result) => result[0]);
  const chargeList = await Promise.all(
    list.map(async (item) => {
      const charge = await db
        .execute(`SELECT idx, period_type, period, charge, deposit FROM charge WHERE locker_type_idx=${item.idx}&&deleted_time IS NULL`)
        .then((result) => result[0]);
      return { ...item, charge: charge };
    })
  );
  res.status(200).json({ chargeList });
});

// 라커 구분 선택 삭제
router.post(
  '/locker-type-delete',
  isAuth,
  [body('idx').trim().notEmpty().withMessage('라커 타입 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const idx = req.body.idx.split(',');
    const date = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const today = dayjs().format('YYYY-MM-DD');
    for (const i of idx) {
      const locker = await db.execute(`SELECT * FROM locker_type WHERE idx=${i}`).then((result) => result[0][0]);
      const findCustomer = await db
        .execute(
          `SELECT idx FROM locker WHERE user_idx=${req.authorizedUser}&&locker_type='${locker.locker_type}'&&end_date >='${today}'&& deleted_time IS NULL && customer_idx IS NOT NULL`
        )
        .then((result) => result[0][0]);
      if (findCustomer) {
        return res.status(409).json({ message: `${locker.locker_type}에 이용중인 사용자가 있습니다.` });
      }
    }
    const locker_types = await db
      .execute(`SELECT locker_type FROM locker_type WHERE idx IN(${idx})`)
      .then((result) => result[0].map((item) => item.locker_type));
    console.log('라커구분', locker_types);
    await db.execute(
      `UPDATE locker SET deleted_time='${date}' WHERE  locker_type IN('${locker_types}')&&  user_idx = ${req.authorizedUser} && deleted_time IS NULL && available=0`
    );
    await db.execute(`UPDATE locker_type SET deleted_time='${date}' WHERE idx IN(${idx})`);
    res.sendStatus(204);
  }
);

// 라커(이용자) 추가
router.post(
  '/locker',
  isAuth,
  [
    body('customer_name').trim().notEmpty().withMessage('사용자 이름을 입력해 주세요.'),
    body('customer_phone').trim().notEmpty().withMessage('사용자 휴대폰 번호를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 구분을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 번호를 입력해 주세요.'),
    body('start_date').trim().notEmpty().withMessage('시작일을 입력해 주세요.'),
    body('end_date').trim().notEmpty().withMessage('종료일을 입력해 주세요.'),
    body('charge').trim().notEmpty().withMessage('요금을 입력해 주세요.'),
    body('paid').trim().notEmpty().withMessage('수납 여부를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { customer_name, customer_phone, locker_type, locker_number, start_date, end_date, charge, paid, memo = '' } = req.body;
    const today = dayjs().format('YYYY-MM-DD');
    const used =
      dayjs(today).diff(start_date, 'day') >= 0
        ? dayjs(end_date).diff(dayjs(today), 'day') >= 0
          ? dayjs(today).diff(dayjs(start_date), 'day') + 1
          : dayjs(end_date).diff(dayjs(start_date), 'day') + 1
        : 0;
    const remain =
      dayjs(today).diff(start_date, 'day') >= 0 ? dayjs(end_date).diff(dayjs(today), 'day') : dayjs(end_date).diff(dayjs(start_date), 'day') + 1;
    const foundCustomer = await db
      .execute(
        `SELECT idx FROM customer WHERE user_idx=${req.authorizedUser}&&name='${customer_name}'&&phone='${customer_phone}'&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);

    if (!foundCustomer) {
      const result = await db.execute('INSERT INTO customer ( user_idx, name, phone, memo, created_time ) VALUES (?,?,?,?,?)', [
        req.authorizedUser,
        customer_name,
        customer_phone,
        memo,
        new Date(),
      ]);
      const customer_idx = result[0].insertId;
      await db.execute(
        'INSERT INTO locker ( user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, created_time, used, remain) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [req.authorizedUser, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, new Date(), used, remain]
      );
      const price = await db.execute(`SELECT charge FROM charge WHERE idx=${charge}`).then((result) => result[0][0].charge);
      await db.execute(
        'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, handled_time) VALUES (?,?,?,?,?,?,?,?,?)',
        ['라카 이용자 추가', req.authorizedUser, customer_idx, locker_type, locker_number, start_date, end_date, price, new Date()]
      );
    } else {
      await db.execute(`UPDATE customer SET memo='${memo}' WHERE idx=${foundCustomer.idx}`);
      await db.execute(
        'INSERT INTO locker ( user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, created_time, used, remain) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [req.authorizedUser, foundCustomer.idx, locker_type, locker_number, start_date, end_date, charge, paid, new Date(), used, remain]
      );
      const price = await db.execute(`SELECT charge FROM charge WHERE idx=${charge}`).then((result) => result[0][0].charge);
      await db.execute(
        'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, handled_time) VALUES (?,?,?,?,?,?,?,?,?)',
        ['라카 이용자 추가', req.authorizedUser, foundCustomer.idx, locker_type, locker_number, start_date, end_date, price, new Date()]
      );
    }

    res.sendStatus(201);
  }
);

// 라커 정보
router.get('/locker-info', isAuth, [query('locker_idx').trim().notEmpty().withMessage('라커 idx를 입력해 주세요.'), validate], async (req, res) => {
  const { locker_idx } = req.query;
  const lockerInfo = await db
    .execute(
      `SELECT charge.charge AS locker_charge, charge.period, charge.deposit, charge.period_type, locker.* FROM charge JOIN locker ON locker.charge=charge.idx WHERE locker.idx=${locker_idx}`
    )
    .then((result) => result[0][0]);

  res.status(200).json(lockerInfo);
});

// 이용자 정보
router.get('/user-info', isAuth, [query('locker_idx').trim().notEmpty().withMessage('라커 idx를 입력해 주세요.'), validate], async (req, res) => {
  const { locker_idx } = req.query;
  const lockerInfo = await db
    .execute(
      `SELECT locker.idx, locker.locker_type,locker_number, customer.name,customer.phone, customer.memo FROM locker JOIN customer ON locker.customer_idx=customer.idx WHERE locker.idx=${locker_idx}`
    )
    .then((result) => result[0][0]);
  res.status(200).json(lockerInfo);
});

// 이용자 관리(이용자 수정)
router.put(
  '/locker',
  isAuth,
  [
    body('locker_idx').trim().notEmpty().withMessage('라커 idx를 입력해 주세요.'),
    body('customer_name').trim().notEmpty().withMessage('사용자 이름을 입력해 주세요.'),
    body('customer_phone').trim().notEmpty().withMessage('사용자 휴대폰 번호를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 구분을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_idx, customer_name, customer_phone, memo = '', locker_type, locker_number, admin, user_idx } = req.body;
    const customer_idx = await db.execute(`SELECT customer_idx FROM locker WHERE idx=${locker_idx}`).then((result) => result[0][0].customer_idx);
    const lockerInfo = await db
      .execute(
        `SELECT charge.charge,locker.user_idx, locker.customer_idx, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date FROM locker JOIN charge ON locker.charge=charge.idx WHERE locker.idx=${locker_idx}`
      )
      .then((result) => result[0][0]);
    const foundCustomer = await db
      .execute(
        `SELECT idx FROM customer WHERE idx!=${lockerInfo.customer_idx}&&user_idx=${
          user_idx ? user_idx : req.authorizedUser
        }&&name='${customer_name}'&&phone='${customer_phone}'&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    console.log('라커이용자 체크', user_idx, foundCustomer);
    if (foundCustomer) {
      return res.status(409).json({ message: '입력하신 이름과 핸드폰 번호로 등록된 회원이 이미 존재합니다.' });
    }
    await db.execute('UPDATE customer SET name=?, phone=?, memo=? WHERE idx=?', [customer_name, customer_phone, memo, customer_idx]);
    await db.execute('UPDATE locker SET locker_type=?, locker_number=?, customer_idx=?, updated_time=? WHERE idx=?', [
      locker_type,
      locker_number,
      customer_idx,
      new Date(),
      locker_idx,
    ]);
    await db.execute(
      'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, handled_time, start_date, end_date, charge) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        `라카 이용자 수정 ${admin ? '(관리자)' : ''}`,
        admin ? lockerInfo.user_idx : req.authorizedUser,
        customer_idx,
        locker_type,
        locker_number,
        new Date(),
        lockerInfo.start_date,
        lockerInfo.end_date,
        lockerInfo.charge,
      ]
    );
    res.sendStatus(204);
  }
);

// 라커(이용자) 기간 연장
router.put(
  '/locker-extend',
  isAuth,
  [
    body('locker_idx').trim().notEmpty().withMessage('라커 idx를 입력해 주세요.'),
    body('end_date').trim().notEmpty().withMessage('종료일을 입력해 주세요.'),
    body('charge').trim().notEmpty().withMessage('요금을 입력해 주세요.'),
    body('paid').trim().notEmpty().withMessage('수납 여부를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_idx, end_date, charge, paid, admin } = req.body;
    const lockerInfo = await db.execute(`SELECT * FROM locker WHERE idx=${locker_idx}&&deleted_time IS NULL`).then((result) => result[0][0]);
    const today = dayjs().format('YYYY-MM-DD');
    const used =
      dayjs(today).diff(end_date, 'day') >= 0
        ? dayjs(end_date).diff(dayjs(lockerInfo.start_date), 'day')
        : dayjs(today).diff(dayjs(lockerInfo.start_date), 'day');
    console.log('사용일', used);
    const remain =
      dayjs(today).diff(lockerInfo.start_date, 'day') >= 0
        ? dayjs(end_date).diff(dayjs(today), 'day')
        : dayjs(end_date).diff(dayjs(lockerInfo.start_date), 'day') + 1;
    console.log(req.body);
    await db.execute('UPDATE locker SET end_date=?, charge=?, paid=?, updated_time=?,used=?, remain=? WHERE idx=?', [
      end_date,
      charge,
      paid,
      new Date(),
      used,
      remain,
      locker_idx,
    ]);
    const price = await db.execute(`SELECT charge FROM charge WHERE idx=${charge}`).then((result) => result[0][0].charge);
    await db.execute(
      'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, handled_time, charge, end_date, start_date) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        `라카 기간 연장 ${admin ? '(관리자)' : ''}`,
        admin ? lockerInfo.user_idx : req.authorizedUser,
        lockerInfo.customer_idx,
        lockerInfo.locker_type,
        lockerInfo.locker_number,
        new Date(),
        price,
        end_date,
        dayjs(lockerInfo.end_date).add(1, 'day').format('YYYY-MM-DD'),
      ]
    );
    res.sendStatus(204);
  }
);

// 라커 수납 여부 설정
router.put(
  '/locker-paid',
  isAuth,
  [
    body('locker_idx').trim().notEmpty().withMessage('라커 idx를 입력해 주세요.'),
    body('paid').trim().notEmpty().withMessage('수납 여부를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_idx, paid } = req.body;
    console.log(req.body);
    await db.execute('UPDATE locker SET paid=?, updated_time=? WHERE idx=?', [paid === '수납' ? '미수납' : '수납', new Date(), locker_idx]);
    res.sendStatus(204);
  }
);

// 라커(이용자) 선택 삭제
router.post('/locker-delete', isAuth, [body('idx').trim().notEmpty().withMessage('라커 idx를 입력해 주세요.'), validate], async (req, res) => {
  const idx = req.body.idx.split(',');
  const isAdmin = req.body.admin ?? false;
  console.log('@@@@@@@@', idx);
  const date = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const list = await db
    .execute(
      `SELECT charge.charge,locker.user_idx, locker.customer_idx, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date FROM locker JOIN charge ON locker.charge=charge.idx WHERE locker.idx IN(${idx})`
    )
    .then((result) => result[0]);
  console.log(list);
  for (const lockerInfo of list) {
    await db.execute(
      'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, handled_time, start_date, end_date, charge) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        `라카 삭제 ${isAdmin ? '(관리자)' : ''}`,
        isAdmin ? lockerInfo.user_idx : req.authorizedUser,
        lockerInfo.customer_idx,
        lockerInfo.locker_type,
        lockerInfo.locker_number,
        new Date(),
        lockerInfo.start_date,
        lockerInfo.end_date,
        lockerInfo.charge,
      ]
    );
  }
  await db.execute(`UPDATE locker SET deleted_time='${date}' WHERE idx IN(${idx})`);
  res.sendStatus(204);
});

// 라커 전체 목록 & 검색 (항목별 오름차순/내림차순 정렬) - 리스트
router.get(
  '/locker-list',
  isAuth,
  [
    query('column').trim().notEmpty().withMessage('정렬할 항목을 입력해 주세요.'),
    query('order').trim().notEmpty().withMessage('정렬 방식을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { column, order, keyword, page } = req.query;
    console.log(req.authorizedUser);
    const amount = req.query.amount ?? 10;
    if (!keyword) {
      const total = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM (SELECT MAX(idx) AS idx FROM locker WHERE locker.user_idx=${req.authorizedUser}&& locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idx JOIN locker ON locker_idx.idx=locker.idx WHERE locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);

      const list = await db
        .execute(
          `
          SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${
            req.authorizedUser
          } && locker.customer_idx IS NOT NULL GROUP BY locker.locker_type, locker.locker_number) locker_idx JOIN locker on locker.idx = locker_idx.idx LEFT JOIN customer ON locker.customer_idx=customer.idx LEFT JOIN charge ON locker.charge=charge.idx WHERE locker.deleted_time IS NULL ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      const lockerCount = await db
        .execute(`SELECT SUM(locker_amount) AS lockerCount FROM locker_type WHERE user_idx=${req.authorizedUser}&&deleted_time IS NULL`)
        .then((result) => result[0][0].lockerCount);
      const expiredCount = await db
        .execute(
          `SELECT COUNT(locker.idx) AS expiredCount FROM (select max(idx) as idx from locker WHERE locker.user_idx=${req.authorizedUser}&& locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.remain=-1&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].expiredCount);
      return res.status(200).json({ total, list, allCount: total, lockerCount, expiredCount });
    } else {
      const total = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM (SELECT MAX(idx) AS idx FROM locker WHERE locker.user_idx=${req.authorizedUser}&& locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx = locker_idxs.idx JOIN customer ON locker.customer_idx = customer.idx  WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const allCount = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM (select max(idx) as idx from locker WHERE locker.user_idx=${req.authorizedUser}&& locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${
            req.authorizedUser
          }&& locker.customer_idx IS NOT NULL GROUP BY locker.locker_type, locker.locker_number) locker_idx JOIN locker on locker.idx = locker_idx.idx LEFT JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      const lockerCount = await db
        .execute(`SELECT SUM(locker_amount) AS lockerCount FROM locker_type WHERE user_idx=${req.authorizedUser}&&deleted_time IS NULL`)
        .then((result) => result[0][0].lockerCount);
      const expiredCount = await db
        .execute(
          `SELECT COUNT(locker.idx) AS expiredCount FROM (select max(idx) as idx from locker WHERE locker.user_idx=${req.authorizedUser}&& locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.remain=-1&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].expiredCount);
      return res.status(200).json({ total, list, allCount, lockerCount, expiredCount });
    }
  }
);

// 라커 타입별 전체 목록 - 배열
router.post('/locker-array', isAuth, async (req, res) => {
  const { locker_type } = req.body;
  const date = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const list = await db
    .execute(
      `SELECT locker.remain, locker.idx, locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date, locker.available, customer.name FROM locker LEFT JOIN customer ON locker.customer_idx=customer.idx WHERE locker.user_idx=${req.authorizedUser}&&locker.locker_type='${locker_type}'&&locker.deleted_time IS NULL&&locker.end_date>'${date}' ORDER BY locker_number`
    )
    .then((result) => result[0]);
  return res.status(200).json({ list });
});

// 30일 이내 만료 라커 목록 - soon
router.get('/locker-list-remain', isAuth, async (req, res) => {
  const { page } = req.query;
  const amount = req.query.amount ?? 5;
  const date30 = dayjs().add(30, 'day').format('YYYY-MM-DD');
  const today = dayjs().format('YYYY-MM-DD');
  const total = await db
    .execute(
      `SELECT COUNT(locker.idx) AS total FROM locker JOIN customer ON locker.customer_idx=customer.idx WHERE locker.user_idx=${req.authorizedUser}&&locker.deleted_time IS NULL&&end_date<='${date30}'&&end_date>='${today}'`
    )
    .then((result) => result[0][0].total);
  const list = await db
    .execute(
      `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx, locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.available, customer.name, customer.phone, locker.paid FROM locker LEFT JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE locker.user_idx=${
        req.authorizedUser
      }&&locker.deleted_time IS NULL&&locker.end_date<='${date30}'&&locker.end_date>='${today}' ORDER BY locker.remain LIMIT ${amount} OFFSET ${
        amount * (page - 1)
      }`
    )
    .then((result) => result[0]);
  console.log(list);
  return res.status(200).json({ total, list });
});

// 만료된 지 30일 이내 라커 목록 - already
router.get('/locker-list-expired', isAuth, async (req, res) => {
  const { page } = req.query;
  const amount = req.query.amount ?? 5;
  const afterDays = dayjs().subtract(31, 'day').format('YYYY-MM-DD');
  const today = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const total = await db
    .execute(
      `SELECT COUNT(locker.idx) AS total FROM locker JOIN customer ON locker.customer_idx=customer.idx WHERE locker.user_idx=${req.authorizedUser}&&locker.end_date BETWEEN '${afterDays}' AND '${today}' && locker.deleted_time IS NULL`
    )
    .then((result) => result[0][0].total);
  const list = await db
    .execute(
      `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx AS idx, locker.customer_idx, locker.locker_number, locker.locker_type, locker.start_date, locker.end_date, locker.used, customer.name, customer.phone, locker.paid FROM locker LEFT JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE locker.user_idx=${
        req.authorizedUser
      }&&locker.end_date BETWEEN '${afterDays}' AND '${today}' && locker.deleted_time IS NULL ORDER BY locker.end_date DESC LIMIT ${amount} OFFSET ${
        amount * (page - 1)
      }`
    )
    .then((result) => result[0]);

  console.log(list);
  return res.status(200).json({ total, list });
});

// 라커 수리중 설정
router.put(
  '/locker-fix',
  isAuth,
  [
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 넘버를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_type, locker_number } = req.body;
    const lockerInfo = await db
      .execute(
        `SELECT * FROM locker WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    console.log(lockerInfo);
    if (lockerInfo) {
      await db.execute(
        `UPDATE locker SET available=0 WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      );
      res.sendStatus(204);
    } else {
      await db.execute(
        'INSERT INTO locker (user_idx, locker_type, locker_number, start_date, end_date, paid, created_time, available) VALUES (?,?,?,?,?,?,?,?)',
        [req.authorizedUser, locker_type, locker_number, new Date(), '9999-12-31', '미수납', new Date(), 0]
      );
      res.sendStatus(204);
    }
  }
);

// 라커 이용가능 설정
router.put(
  '/locker-available',
  isAuth,
  [
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 넘버를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_type, locker_number } = req.body;
    const lockerInfo = await db
      .execute(
        `SELECT * FROM locker WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&available=0&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    console.log(lockerInfo);
    if (lockerInfo.customer_idx) {
      await db.execute(
        `UPDATE locker SET available=1 WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      );
      res.sendStatus(204);
    } else {
      const date = dayjs().format('YYYY-MM-DD HH:mm:ss');
      await db.execute(
        `UPDATE locker SET deleted_time='${date}' WHERE user_idx=${req.authorizedUser}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      );
      res.sendStatus(204);
    }
  }
);

// 전체 회원 목록(라커 이용 정보) & 검색
router.get('/customer-list', isAuth, async (req, res) => {
  const { keyword, user_idx, page } = req.query;
  console.log(req.query);
  const amount = req.query.amount ?? 10; //  const amount = req.query.amount ? req.query.amount : 10;
  if (!keyword) {
    const total = await db
      .execute(`SELECT idx FROM customer WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&deleted_time IS NULL`)
      .then((result) => result[0]);
    const list = await db
      .execute(
        `SELECT idx, name, phone, memo FROM customer WHERE user_idx=${
          user_idx ? user_idx : req.authorizedUser
        }&&deleted_time IS NULL ORDER BY idx DESC LIMIT ${amount} OFFSET ${Number(amount) * (Number(page) - 1)}`
      )
      .then((result) => {
        console.log(result);
        return result[0];
      });
    console.log('리스트트트트', list);
    const date = dayjs().format('YYYY-MM-DD');
    const result = await Promise.all(
      list.map(async (item) => {
        const count = await db
          .execute(
            `SELECT COUNT(customer_idx) AS count FROM locker WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&customer_idx=${
              item.idx
            }&&end_date>='${date}'&&deleted_time IS NULL`
          )
          .then((result) => result[0][0]);
        const chartCount = await db
          .execute(
            `SELECT COUNT(customer_idx) AS chartCount FROM drilling_chart WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&customer_idx=${
              item.idx
            }&&deleted_time IS NULL`
          )
          .then((result) => result[0][0]);
        return { ...item, count: count.count, chartCount: chartCount.chartCount };
      })
    );
    res.status(200).json({ total: total.length, list: result });
  } else {
    const total = await db
      .execute(
        `SELECT idx FROM customer WHERE user_idx=${
          user_idx ? user_idx : req.authorizedUser
        }&&(name LIKE \'%${keyword}%\'||phone LIKE \'%${keyword}%\'||memo LIKE \'%${keyword}%\')&&deleted_time IS NULL`
      )
      .then((result) => result[0]);
    const list = await db
      .execute(
        `SELECT idx, name, phone, memo FROM customer WHERE user_idx=${
          user_idx ? user_idx : req.authorizedUser
        }&&(name LIKE \'%${keyword}%\'||phone LIKE \'%${keyword}%\'||memo LIKE \'%${keyword}%\')&&deleted_time IS NULL ORDER BY idx DESC LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    const date = dayjs().format('YYYY-MM-DD');
    const result = await Promise.all(
      list.map(async (item) => {
        const count = await db
          .execute(
            `SELECT COUNT(customer_idx) AS count FROM locker WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&customer_idx=${
              item.idx
            }&&end_date>='${date}'&&deleted_time IS NULL`
          )
          .then((result) => result[0][0]);
        const chartCount = await db
          .execute(
            `SELECT COUNT(customer_idx) AS chartCount FROM drilling_chart WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&customer_idx=${
              item.idx
            }&&deleted_time IS NULL`
          )
          .then((result) => result[0][0]);
        return { ...item, count: count.count, chartCount: chartCount.chartCount };
      })
    );
    res.status(200).json({ total: total.length, list: result });
  }
});

// 전체 회원 라커 상세
router.get(
  '/customer-locker',
  isAuth,
  [query('customer_idx').trim().notEmpty().withMessage('사용자 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { column, order, customer_idx, page, user_idx } = req.query;
    const amount = req.query.amount ?? 10;
    const customerName = await db.execute(`SELECT name FROM customer WHERE idx=${customer_idx}`).then((result) => result[0][0].name);
    console.log(customerName);
    const total = await db
      .execute(`SELECT COUNT(idx) AS total FROM locker WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&customer_idx=${customer_idx}`)
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT charge.charge, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.deleted_time, locker.remain FROM locker JOIN charge ON locker.charge=charge.idx WHERE locker.user_idx=${
          user_idx ? user_idx : req.authorizedUser
        }&&locker.customer_idx=${customer_idx} ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${amount * (page - 1)}`
      )
      .then((result) => result[0]);

    res.status(200).json({ total, list, customerName });
  }
);

// 사용 중인 라커 번호
router.get(
  '/locker-number',
  isAuth,
  [query('locker_type_idx').trim().notEmpty().withMessage('라커 타입 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { locker_type_idx } = req.query;
    const lockerNumber = await db
      .execute(
        `SELECT locker.locker_number FROM locker JOIN locker_type ON locker.user_idx=locker_type.user_idx&&locker.locker_type=locker_type.locker_type WHERE locker_type.idx=${locker_type_idx}&&locker.remain>-1&&locker.deleted_time IS NULL`
      )
      .then((result) => result[0]);
    const result = lockerNumber.map((item) => Object.values(item)).flat();
    console.log(result);
    res.status(200).json({ lockerNumber: result });
  }
);

// 이전 사용자 불러오기 - 라커 이용자 추가할 때 사용
router.get(
  '/customer-prev',
  isAuth,
  [
    query('locker_type_idx').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    query('locker_number').trim().notEmpty().withMessage('라커 번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { locker_type_idx, locker_number } = req.query;
    console.log(req.query);
    const data = await db
      .execute(
        `SELECT customer.name, customer.phone, customer.memo, customer.deleted_time, locker.deleted_time AS locker_deleted_time, locker.idx AS lockerIdx, customer.idx AS customerIdx FROM locker_type JOIN locker ON locker.locker_type=locker_type.locker_type&&locker_type.user_idx=locker.user_idx JOIN customer ON customer.idx=locker.customer_idx WHERE locker_type.idx=${Number(
          locker_type_idx
        )}&&locker.locker_number=${Number(locker_number)} ORDER BY locker.idx DESC LIMIT 1`
      )
      .then((result) => result[0][0]);
    if (data) {
      if (data.deleted_time) {
        console.log('삭제된 회원임. 이전 사용자 없음', data);
        res.sendStatus(400);
      } else {
        if (data.locker_deleted_time) {
          console.log('삭제된 라커임. 이전 사용자 없음', data);
          res.sendStatus(400);
        } else {
          console.log('직전 사용자 정보', data);
          res.status(200).json(data);
        }
      }
    } else {
      console.log('이전 사용자 없음');
      res.sendStatus(400);
    }
  }
);

// [엑셀 다운로드용] 라커 전체 목록 & 검색 (항목별 오름차순/내림차순 정렬) - 리스트
router.get(
  '/locker-list-excel',
  isAuth,
  [
    query('column').trim().notEmpty().withMessage('정렬할 항목을 입력해 주세요.'),
    query('order').trim().notEmpty().withMessage('정렬 방식을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { column, order, keyword } = req.query;
    console.log(req.query);
    if (!keyword) {
      const list = await db
        .execute(
          `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${req.authorizedUser} GROUP BY locker.locker_type, locker.locker_number) locker_idxs JOIN locker ON locker_idxs.idx=locker.idx JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE locker.deleted_time IS NULL ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      return res.status(200).json(list);
    } else {
      const list = await db
        .execute(
          `SELECT charge.charge, charge.period, charge.deposit,charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid,locker.deleted_time AS deleted_time, customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${req.authorizedUser} GROUP BY locker.locker_type, locker.locker_number) locker_idxs JOIN locker ON locker_idxs.idx=locker.idx JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      res.status(200).json(list);
    }
  }
);

// 회원 정보로 메모 불러오기 (라커 이용자 추가 시 사용)
router.post(
  '/customer-memo',
  isAuth,
  [
    body('name').trim().notEmpty().withMessage('name을 입력해 주세요.'),
    body('phone').trim().notEmpty().withMessage('phone을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { name, phone } = req.body;
    const user = await db
      .execute(`SELECT memo FROM customer WHERE user_idx=${req.authorizedUser}&&name='${name}'&&phone='${phone}'&&deleted_time IS NULL`)
      .then((result) => result[0][0]);
    console.log(name, phone, user);
    if (user) {
      res.status(200).json(user.memo);
    } else {
      res.sendStatus(400);
    }
  }
);

export default router;
