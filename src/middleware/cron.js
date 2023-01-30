import dayjs from 'dayjs';
import { db } from '../db/database.js';
import { talkPush } from './functions.js';

// 라커 사용일, 잔여일 재설정
export async function calculateDate() {
  const today = dayjs().format('YYYY-MM-DD');
  console.log('오늘', today);
  const lockerIdxs = await db
    .execute(`SELECT idx, start_date, end_date FROM locker WHERE end_date>='${today}'&&customer_idx IS NOT NULL&&deleted_time IS NULL`)
    .then((result) => result[0]);
  for (const item of lockerIdxs) {
    const used = dayjs(today).diff(item.start_date, 'day') >= 0 ? dayjs(today).diff(dayjs(item.start_date), 'day') + 1 : 0;
    const remain =
      dayjs(today).diff(item.start_date, 'day') >= 0
        ? dayjs(item.end_date).diff(dayjs(today), 'day')
        : dayjs(item.end_date).diff(dayjs(item.start_date), 'day') + 1;
    await db.execute(`UPDATE locker SET used=${used}, remain=${remain} WHERE idx=${item.idx} `);
  }
  const zeroIdxs = await db
    .execute(`SELECT idx, start_date, end_date FROM locker WHERE end_date<'${today}'||deleted_time IS NOT NULL`)
    .then((result) => result[0]);
  for (const item of zeroIdxs) {
    const used = dayjs(item.end_date).diff(dayjs(item.start_date), 'day') + 1;
    await db.execute(`UPDATE locker SET used=${used}, remain=${-1} WHERE idx=${item.idx} `);
  }
}

// 만료 1,3,7,15,30일 전 카카오 알림톡 발송
export async function remain3Days() {
  const days = [1, 3, 7, 15, 30];
  const kakaoList = [];
  for (const day of days) {
    const lockerList = await db
      .execute(
        `SELECT customer.user_idx AS user_idx, customer.name AS customer_name, customer.phone AS customer_phone, store.name AS store_name, store.contact AS store_contact, locker.locker_type AS locker_type, locker.locker_number AS locker_number, locker.end_date AS end_date FROM talk_dday JOIN locker_type ON talk_dday.locker_type_idx = locker_type.idx JOIN locker ON locker_type.user_idx = locker.user_idx AND locker_type.locker_type=locker.locker_type JOIN customer ON locker.customer_idx = customer.idx JOIN store ON locker.user_idx = store.user_idx WHERE talk_dday.dday=${day} && talk_dday.deleted_time IS NULL && locker_type.deleted_time IS NULL && locker.remain=${day}`
      )
      .then((result) => result[0]);
    for (const customer of lockerList) {
      kakaoList.push(talkPush({ ...customer, dday: day }));
      console.log(customer);
    }
  }
  Promise.all(kakaoList);
}

// 가맹점 유료회원 만료일 체크
export async function checkUserGrade() {
  const today = dayjs().format('YYYY-MM-DD');
  const userList = await db
    .execute(
      `SELECT user.idx FROM user JOIN payment_history ON user.idx = payment_history.user_idx where user.grade=1 && (SELECT end_date FROM payment_history WHERE payment_history.user_idx = user.idx ORDER BY payment_history.idx asc limit 1) < '${today}' GROUP BY user.idx`
    )
    .then((result) => result[0]);

  if (userList.length > 0) {
    const userArr = userList.map((item) => item.idx);
    await db.execute(`UPDATE user SET grade=0 WHERE idx in(${userArr})`);
    await db.execute(`UPDATE talk_dday SET deleted_time=${today} WHERE user_idx in(${userArr}) && dday!=3`);
  }
  return true;
}
