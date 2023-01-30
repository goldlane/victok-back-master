import { validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { db } from '../db/database.js';
import multer from 'multer';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import dayjs from 'dayjs';

// 유효성 검사
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  return res.status(400).json({ message: errors.array()[0].msg });
}

// 사용자 인증
export function isAuth(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!(authHeader && authHeader.startsWith('Bearer '))) {
    return res.status(401).json({ message: '인증 에러1(header)' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, config.jwt.secretKey, async (error, decoded) => {
    if (error) {
      return res.status(401).json({ message: '인증 에러2(token)' });
    }
    const found = await db.execute('SELECT * FROM user WHERE idx=?', [decoded.idx]).then((result) => result[0][0]);
    if (!found) {
      return res.status(401).json({ message: '인증 에러3(user)' });
    }
    req.authorizedUser = found.idx;
    req.token = token;
    next();
  });
}

// 이미지 업로드
export const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'src/data/uploads/');
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    },
  }),
});

// 이미지 삭제
export const delFile = async (file) => {
  fs.unlink(file, function (err) {
    if (err) {
      console.log('Error : ', err);
    }
  });
};

// 인증 문자 발송
export async function smsPush(phone, number) {
  try {
    console.log(phone, number);
    const smsText = `[빅톡] 인증번호[${number}]를 입력해주세요`;
    const form = new FormData();
    form.append('key', config.aligo.key);
    form.append('user_id', config.aligo.id);
    form.append('sender', config.aligo.sender);
    form.append('receiver', phone);
    form.append('msg', smsText);
    form.append('msg_type', 'SMS');
    const formHeaders = form.getHeaders();
    const res = await axios.post('https://apis.aligo.in/send/', form, { headers: { ...formHeaders, 'Content-Length': form.getLengthSync() } });
    console.log(res);
  } catch (error) {
    console.log(error);
  }
}

// 카카오 알림톡 발송
export async function talkPush(receiver) {
  // console.log(receiver);
  try {
    const url = 'https://kakaoapi.aligo.in/akv10/token/create/30/s/';
    const form = new FormData();
    const formHeaders = form.getHeaders();
    form.append('apikey', config.aligo.key);
    form.append('userid', config.aligo.id);
    const res1 = await axios.post(url, form, { headers: { ...formHeaders, 'Content-Length': form.getLengthSync() } });
    // console.log(res1.data);
    if (res1.data.code === 0) {
      const token = res1.data.token;
      const templateURL = 'https://kakaoapi.aligo.in/akv10/template/list/';
      const form2 = new FormData();
      form2.append('apikey', config.aligo.key);
      form2.append('userid', config.aligo.id);
      form2.append('token', token);
      form2.append('senderkey', config.aligo.senderkey);
      const formHeaders2 = form2.getHeaders();
      const res2 = await axios.post(templateURL, form2, { headers: { ...formHeaders2, 'Content-Length': form2.getLengthSync() } });
      // console.log(res2.data);
      if (res2.data.code === 0) {
        const date = dayjs(receiver.end_date).subtract(1, 'day').format('YYYY-MM-DD');
        const templtBody = res2.data.list
          .find((item) => item.templtCode === 'TJ_1618')
          .templtContent.replace('#{회사명}', '빅톡')
          .replace('#{고객명}', receiver.customer_name)
          .replace('#{볼링장명}', receiver.store_name)
          .replace('#{구분}', receiver.locker_type)
          .replace('#{라카번호}', `${receiver.locker_number}번`)
          .replace('#{연월일}', receiver.end_date)
          .replace('#{만료전날}', date)
          .replace('#{볼링장명}', receiver.store_name)
          .replace('#{알림일}', receiver.dday)
          .replace('#{볼링장번호}', receiver.store_contact);
        // console.log(templtBody);
        const sendURL = 'https://kakaoapi.aligo.in/akv10/alimtalk/send/';
        const form3 = new FormData();
        form3.append('apikey', config.aligo.key);
        form3.append('userid', config.aligo.id);
        form3.append('token', token);
        form3.append('senderkey', config.aligo.senderkey);
        form3.append('tpl_code', 'TJ_1618');
        form3.append('sender', config.aligo.sender);
        form3.append('receiver_1', receiver.customer_phone);
        form3.append('subject_1', '빅톡_라카알림');
        form3.append('message_1', templtBody);
        const formHeaders3 = form3.getHeaders();
        // console.log('폼확인', form3);
        const res3 = await axios.post(sendURL, form3, { headers: { ...formHeaders3, 'Content-Length': form3.getLengthSync() } });
        // console.log(res3.data);
        console.log(receiver);
        if (res3.data.code === 0) {
          await db.execute(
            'INSERT INTO talk_log (type, user_idx, store_name, customer_name, customer_phone, locker_type, locker_number, end_date, created_time) VALUES (?,?,?,?,?,?,?,?,?)',
            [
              '라카 만료 알림',
              receiver.user_idx,
              receiver.store_name,
              receiver.customer_name,
              receiver.customer_phone,
              receiver.locker_type,
              receiver.locker_number,
              receiver.end_date,
              new Date(),
            ]
          );
        }
        return true;
      }
    }
  } catch (error) {
    console.log(error);
    return false;
  }
}
