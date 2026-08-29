export type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type PushStatusActionResult =
  | { ok: true; registered: boolean }
  | { ok: false; message: string };

export type DuePushNotification = {
  delivery_id: string;
  attempt_count: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string;
};

export type PushMessagePayload = {
  title: string;
  body: string;
  icon: string;
  url: string;
  tag: string;
};
