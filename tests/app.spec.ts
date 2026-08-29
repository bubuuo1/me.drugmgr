import { expect, test, type Locator, type Page } from "@playwright/test";

const runSuffix = Date.now().toString(36).slice(-7);
const testMedicationName = "E2E기록약-" + runSuffix;
const keptScheduleTime = "06:37";
const editedScheduleTime = "22:44";
const scheduledLogNote = "일정 연결 기록 " + runSuffix;
const editedLogNote = "수정된 투약 기록 " + runSuffix;
const statusNote = "상태 기록 " + runSuffix;
const firstDuplicateNote = "첫 중복 검사 기록 " + runSuffix;
const secondDuplicateNote = "중복 확인 기록 " + runSuffix;

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
});

test.afterEach(async ({ page }) => {
  expect(
    browserErrors.get(page) ?? [],
    "브라우저 console error 또는 pageerror가 없어야 합니다."
  ).toEqual([]);
});

function kstDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function kstDateTime(time: string) {
  return kstDateKey() + "T" + time;
}

function shiftDateKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function selectPressed(button: Locator) {
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
  }
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function finishPossibleDuplicateDialog(page: Page) {
  const savedRegion = page.getByRole("region", { name: "저장 완료" });
  const dialog = page.getByRole("dialog");
  await expect(savedRegion.or(dialog)).toBeVisible();
  if (await dialog.isVisible()) {
    await dialog
      .getByRole("button", { name: "새 기록 추가", exact: true })
      .click();
  }
  await expect(savedRegion).toBeVisible();
}

test("홈에서 빠른 기록, 상태, 복용기록과 모바일 하단 메뉴가 보인다", async ({
  page,
}) => {
  await page.goto("/");

  const quickLogSection = page.locator("main > :first-child");
  await expect(
    quickLogSection.getByRole("heading", {
      level: 1,
      name: "빠른 투약 기록",
    })
  ).toHaveClass(/sr-only/);
  await expect(
    page.getByText("복용한 약을 선택하면 수량과 실제 시각을 확인할 수 있습니다.")
  ).toHaveCount(0);

  for (const medicationName of ["메스티논", "소론도", "셉트린정"]) {
    const medicationCard = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: medicationName,
        exact: true,
      }),
    });
    await expect(medicationCard).toBeVisible();
    await expect(medicationCard.getByRole("link")).toBeVisible();
  }

  await expect(page.getByRole("link", { name: /오늘 상태/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "복용기록 확인", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "환경설정", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "가족 공간과 계정" })
  ).toHaveCount(0);
});

test("현재 가족 공간을 확인하고 Google 계정 초대를 만들 수 있다", async ({
  page,
}) => {
  await page.goto("/settings");

  const accountSection = page.getByRole("region", {
    name: "계정과 가족",
  });
  await expect(accountSection.getByLabel("기록 대상")).toHaveValue(
    "mock-care-space"
  );
  await accountSection
    .getByRole("link", { name: /가족 관리/ })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "가족 공유" })
  ).toBeVisible();
  await expect(
    page.locator("main header").getByRole("link", {
      name: "환경설정으로 이동",
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText("테스트 사용자", { exact: true })).toBeVisible();

  const caregiverRow = page
    .getByRole("listitem")
    .filter({ hasText: "테스트 보호자" });
  await caregiverRow
    .getByRole("button", { name: "접근 제거", exact: true })
    .click();
  const removalDialog = page.getByRole("dialog", {
    name: "가족 접근을 제거할까요?",
  });
  await removalDialog
    .getByRole("button", { name: "접근 권한 제거", exact: true })
    .click();
  await expect(caregiverRow).toHaveCount(0);

  const inviteEmail = `family-${runSuffix}@example.com`;
  await page
    .getByLabel("초대할 이메일", { exact: true })
    .fill(inviteEmail);
  await page.getByLabel("권한", { exact: true }).selectOption("viewer");
  await page
    .getByRole("button", { name: "초대 메일 보내기", exact: true })
    .click();

  await expect(
    page.getByText(new RegExp(`${inviteEmail} 주소로 초대 메일을 보냈습니다`))
  ).toBeVisible();
  const inviteRow = page.getByRole("listitem").filter({ hasText: inviteEmail });
  await expect(inviteRow).toContainText("조회 전용");
});

test("가족 공간을 바꾸면 이전 사람의 작성 중 상태와 데이터가 남지 않는다", async ({
  page,
}) => {
  await page.goto("/status");
  await selectPressed(page.getByRole("button", { name: /^거의 없음/ }));
  await page.evaluate(() => {
    document.documentElement.dataset.initialHomeLoadingReappeared = "false";
    const observer = new MutationObserver(() => {
      if (document.body.textContent?.includes("오늘 기록을 불러오는 중입니다.")) {
        document.documentElement.dataset.initialHomeLoadingReappeared = "true";
        observer.disconnect();
      }
    });
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  await page.getByRole("link", { name: "환경설정", exact: true }).click();
  const spaceSelect = page.getByLabel("기록 대상");
  await spaceSelect.selectOption("mock-second-care-space");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(spaceSelect).toHaveValue("mock-second-care-space");
  await page.getByRole("link", { name: "첫 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("활성화된 약이 없습니다.")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "메스티논", exact: true })
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.dataset.initialHomeLoadingReappeared
      )
    )
    .toBe("false");

  await page.goto("/status");
  await expect(page.getByRole("button", { name: /^거의 없음/ })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("새로 열면 소유자 기록이 기본이고 알림 딥링크는 가족 기록을 우선한다", async ({
  page,
}) => {
  await page.goto("/settings");
  const spaceSelect = page.getByLabel("기록 대상");
  await spaceSelect.selectOption("mock-second-care-space");
  await expect(spaceSelect).toHaveValue("mock-second-care-space");

  await page.reload();
  await expect(page.getByLabel("기록 대상")).toHaveValue("mock-care-space");

  await page.goto("/?space=mock-second-care-space");
  await expect(page.getByRole("complementary", { name: "현재 기록 대상" }))
    .toContainText("두 번째 복약 공간 · 보호자");
  await expect(page.getByText("활성화된 약이 없습니다.")).toBeVisible();
});

test("320px 모바일 화면에서 주요 화면에 가로 스크롤이 생기지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });

  for (const path of ["/", "/records", "/settings", "/family"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        )
      )
      .toBe(true);
  }
});

test("복용기록 날짜를 이전·오늘·직접 선택으로 안전하게 이동한다", async ({
  page,
}) => {
  await page.goto("/records");

  const dateInput = page.getByLabel("날짜 직접 선택", { exact: true });
  const today = kstDateKey();
  await expect(dateInput).toHaveValue(today);
  await expect(
    page.getByRole("button", { name: "현재 날짜는 오늘", exact: true })
  ).toBeDisabled();

  await page.getByRole("button", { name: /^이전 날짜,/ }).click();
  await expect(dateInput).toHaveValue(shiftDateKey(today, -1));
  await page
    .getByRole("button", { name: "오늘 날짜로 이동", exact: true })
    .click();
  await expect(dateInput).toHaveValue(today);

  await dateInput.fill("");
  await expect(page.locator("#record-date-error")).toContainText(
    "날짜를 선택해 주세요."
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "복용기록 확인" })
  ).toBeVisible();

  await dateInput.fill("2026-08-28");
  await expect(dateInput).toHaveValue("2026-08-28");
  await expect(page.locator('time[datetime="2026-08-28"]')).toBeVisible();
});

test("로그아웃하면 현재 기록을 지우고 로그인 화면만 표시한다", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "내 기록을 안전하게 이어가세요" })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" })
  ).toHaveCount(0);
  await expect(page.getByText("메스티논", { exact: true })).toHaveCount(0);
});

test("파비콘, 설치용 앱 아이콘과 알림 배지를 제공한다", async ({ page }) => {
  await page.goto("/");

  const assetHrefs = await Promise.all([
    page.locator('link[rel="icon"][href*="favicon.ico"]').getAttribute("href"),
    page.locator('link[rel="icon"][href*="icon.svg"]').getAttribute("href"),
    page.locator('link[rel="apple-touch-icon"]').getAttribute("href"),
  ]);

  for (const href of assetHrefs) {
    expect(href).not.toBeNull();
    const response = await page.request.get(new URL(href ?? "/", page.url()).href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image");
  }

  const notificationBadge = await page.request.get("/notification-badge.png");
  expect(notificationBadge.status()).toBe(200);
  expect(notificationBadge.headers()["content-type"]).toContain("image/png");
  const notificationBadgeBytes = await notificationBadge.body();
  expect(notificationBadgeBytes.readUInt32BE(16)).toBe(96);
  expect(notificationBadgeBytes.readUInt32BE(20)).toBe(96);

  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestHref).not.toBeNull();
  const manifestResponse = await page.request.get(
    new URL(manifestHref ?? "/manifest.webmanifest", page.url()).href
  );
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/notification-badge.png",
        sizes: "96x96",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
  });
});

test("서비스 워커는 오프라인 캐시 없이 푸시 알림만 처리한다", async ({
  page,
}) => {
  const response = await page.request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/javascript");
  expect(response.headers()["cache-control"]).toContain("no-store");

  const source = await response.text();
  expect(source).toContain('addEventListener("push"');
  expect(source).toContain('addEventListener("notificationclick"');
  expect(source).toContain("getNotifications()");
  expect(source).toContain("notification.close()");
  expect(source).toContain("async function displayPushNotification");
  expect(source).toContain("notificationDisplayQueue");
  expect(source).toContain('badge: "/notification-badge.png"');
  expect(source).toContain("closeNotificationGroup(event.notification)");
  expect(source).toContain("silent: false");
  expect(source).toContain("vibrate: [300, 150, 300, 150, 500]");
  expect(source).toContain("logicalTag: payload.tag");
  expect(source).not.toContain("tag: payload.tag");
  expect(source).not.toContain('addEventListener("fetch"');
});

test("설정에서 기기 알림을 관리하고 발송 API는 비밀값을 요구한다", async ({
  page,
}) => {
  await page.goto("/settings");
  const notificationSection = page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: "투약 일정 알림" }),
  });
  await expect(notificationSection).toBeVisible();
  await expect(notificationSection).toContainText("5분마다");

  const unauthorized = await page.request.post("/api/push/dispatch", {
    headers: { Authorization: "Bearer wrong-secret" },
  });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["cache-control"]).toContain("no-store");
});

test("설정부터 예정 기록, 상태, 기록 수정·삭제·복원까지 이어진다", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "환경설정" })
  ).toBeVisible();
  await expect(
    page.locator("main header").getByRole("link", {
      name: "첫 화면으로 이동",
      exact: true,
    })
  ).toHaveCount(0);
  await expect(
    page.getByText(/처방받은 약 이름, 수량 선택지와 예정 시각/)
  ).toHaveCount(0);

  await page.getByRole("button", { name: "새 약 추가", exact: true }).click();
  const medicationForm = page.getByRole("group", { name: "새 약" });
  await medicationForm
    .getByLabel("약 이름", { exact: true })
    .fill(testMedicationName);
  await medicationForm.getByLabel("단위", { exact: true }).fill("정");
  await medicationForm
    .getByRole("textbox", { name: /^빠른 수량 선택지/ })
    .fill("0.5, 1, 1.5");
  await medicationForm
    .getByRole("button", { name: "약 설정 저장", exact: true })
    .click();
  await expect(
    page.getByText(testMedicationName + " 설정을 추가했습니다.", {
      exact: true,
    })
  ).toBeVisible();

  const settingsCard = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 3,
      name: testMedicationName,
      exact: true,
    }),
  });
  await expect(settingsCard).toBeVisible();

  await settingsCard
    .getByRole("button", {
      name: `${testMedicationName} 알림 시간 추가`,
      exact: true,
    })
    .click();
  let scheduleForm = settingsCard.getByRole("group", {
    name: testMedicationName + " 새 복용·알림 시간 입력",
  });
  await scheduleForm
    .getByRole("button", { name: "이 시간 추가", exact: true })
    .click();
  await expect(scheduleForm.getByRole("alert")).toContainText(
    "예정 시각을 입력해 주세요."
  );
  await scheduleForm
    .getByLabel("예정 시각", { exact: true })
    .fill(keptScheduleTime);
  await expect(scheduleForm.getByText(/예정 수량/)).toHaveCount(0);
  await expect(scheduleForm.locator('input[type="number"]')).toHaveCount(0);
  await scheduleForm
    .getByRole("button", { name: "이 시간 추가", exact: true })
    .click();
  await expect(
    settingsCard
      .getByRole("listitem")
      .filter({ hasText: keptScheduleTime })
  ).toBeVisible();
  await expect(
    settingsCard.getByRole("heading", {
      level: 4,
      name: "복용·알림 시간 (1개)",
      exact: true,
    })
  ).toBeVisible();
  scheduleForm = settingsCard.getByRole("group", {
    name: testMedicationName + " 새 복용·알림 시간 입력",
  });
  await expect(scheduleForm.getByLabel("예정 시각", { exact: true })).toHaveValue(
    ""
  );
  await scheduleForm.getByLabel("예정 시각", { exact: true }).fill("22:43");
  await scheduleForm
    .getByRole("button", { name: "이 시간 추가", exact: true })
    .click();
  await expect(
    settingsCard.getByRole("heading", {
      level: 4,
      name: "복용·알림 시간 (2개)",
      exact: true,
    })
  ).toBeVisible();
  await settingsCard
    .getByRole("button", {
      name: `${testMedicationName} 시간 추가 닫기`,
      exact: true,
    })
    .click();
  await expect(
    settingsCard.getByRole("group", {
      name: testMedicationName + " 새 복용·알림 시간 입력",
    })
  ).toHaveCount(0);
  await expect(
    page.getByText(/다른 시간도 이어서 추가할 수 있습니다/)
  ).toHaveCount(0);

  let temporarySchedule = settingsCard
    .getByRole("listitem")
    .filter({ hasText: "22:43" });
  await temporarySchedule
    .getByRole("button", {
      name: `${testMedicationName} 22:43 수정`,
      exact: true,
    })
    .click();
  const editScheduleForm = temporarySchedule.getByRole("group", {
    name: `${testMedicationName} 22:43 복용·알림 시간 수정`,
  });
  await editScheduleForm
    .getByLabel("예정 시각", { exact: true })
    .fill(editedScheduleTime);
  await expect(editScheduleForm.getByText(/예정 수량/)).toHaveCount(0);
  await expect(editScheduleForm.locator('input[type="number"]')).toHaveCount(0);
  await editScheduleForm
    .getByRole("button", { name: "일정 수정 저장", exact: true })
    .click();

  temporarySchedule = settingsCard
    .getByRole("listitem")
    .filter({ hasText: editedScheduleTime });
  await expect(temporarySchedule).toBeVisible();
  await temporarySchedule
    .getByRole("button", {
      name: `${testMedicationName} ${editedScheduleTime} 복용·알림 시간 삭제`,
      exact: true,
    })
    .click();
  const scheduleDeleteDialog = page.getByRole("dialog", {
    name: "복용·알림 시간을 삭제할까요?",
  });
  await expect(scheduleDeleteDialog).toContainText(testMedicationName);
  await expect(scheduleDeleteDialog).toContainText(editedScheduleTime);
  await scheduleDeleteDialog
    .getByRole("button", { name: "복용·알림 시간 삭제", exact: true })
    .click();
  await expect(
    settingsCard
      .getByRole("listitem")
      .filter({ hasText: editedScheduleTime })
  ).toHaveCount(0);

  await settingsCard
    .getByRole("button", {
      name: `${testMedicationName} 알림 시간 추가`,
      exact: true,
    })
    .click();
  await settingsCard
    .getByRole("button", { name: "약 비활성화", exact: true })
    .click();
  const medicationDeactivateDialog = page.getByRole("dialog", {
    name: "약을 비활성화할까요?",
  });
  await medicationDeactivateDialog
    .getByRole("button", { name: "약 비활성화", exact: true })
    .click();
  await expect(
    settingsCard.getByRole("group", {
      name: testMedicationName + " 새 복용·알림 시간 입력",
    })
  ).toHaveCount(0);
  await expect(
    settingsCard.getByRole("button", {
      name: `${testMedicationName} 알림 시간 추가`,
      exact: true,
    })
  ).toHaveCount(0);
  await settingsCard
    .getByRole("button", { name: "약 다시 활성화", exact: true })
    .click();
  await expect(
    settingsCard.getByRole("button", {
      name: `${testMedicationName} 알림 시간 추가`,
      exact: true,
    })
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "첫 화면", exact: true })
    .click();
  const homeMedicationCard = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: testMedicationName,
      exact: true,
    }),
  });
  const scheduledLink = homeMedicationCard.getByRole("link", {
    name: keptScheduleTime + " 예정 기록",
    exact: true,
  });
  await expect(page.getByText(/예정 수량/)).toHaveCount(0);
  const scheduledHref = await scheduledLink.getAttribute("href");
  expect(scheduledHref).not.toBeNull();
  const scheduleId = new URL(scheduledHref!, "http://localhost").searchParams.get(
    "schedule"
  );
  expect(scheduleId).toBeTruthy();
  await scheduledLink.click();

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: testMedicationName,
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: keptScheduleTime + " 예정 기록",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "0.5정", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "1.5정", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1.5정", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByLabel("실제 복용 시각", { exact: true })
    .fill(kstDateTime("06:39"));
  await page
    .getByLabel("메모 (선택)", { exact: true })
    .fill(scheduledLogNote);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page.getByRole("region", { name: "저장 완료" })).toContainText(
    "기록 완료"
  );
  await expect(page.getByRole("region", { name: "저장 완료" })).toContainText(
    "1.5정"
  );
  await page.getByRole("link", { name: "첫 화면으로", exact: true }).click();

  const scheduleRow = page
    .getByRole("region", { name: "오늘 예정" })
    .getByRole("listitem")
    .filter({ hasText: keptScheduleTime + " · " + testMedicationName });
  await expect(scheduleRow).toContainText("실제 기록 06:39");
  await expect(scheduleRow).toContainText("기록됨");
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: testMedicationName })
      .getByRole("link", { name: "추가 복용 기록", exact: true })
  ).toBeVisible();

  await page
    .getByRole("link", { name: "복용기록 확인", exact: true })
    .click();
  const timeline = page.getByRole("region", { name: "투약 타임라인" });
  let logItem = timeline
    .getByRole("listitem")
    .filter({ hasText: scheduledLogNote });
  await expect(logItem).toContainText("예정 " + keptScheduleTime);
  await logItem.getByRole("button", { name: "수정", exact: true }).click();

  const editForm = page
    .getByRole("heading", {
      level: 4,
      name: testMedicationName + " 기록 수정",
      exact: true,
    })
    .locator("..");
  await expect(
    editForm.getByRole("combobox", { name: "일정 연결", exact: true })
  ).toHaveValue(scheduleId!);
  await editForm
    .getByLabel("복용 수량 (정)", { exact: true })
    .fill("1.25");
  await editForm
    .getByLabel("실제 복용 시각", { exact: true })
    .fill(kstDateTime("13:21"));
  await editForm
    .getByRole("textbox", { name: "메모 (선택)", exact: true })
    .fill(editedLogNote);
  await editForm
    .getByRole("button", { name: "수정 내용 저장", exact: true })
    .click();
  await expect(page.getByText(/기록을 수정했습니다/)).toBeVisible();

  logItem = timeline.getByRole("listitem").filter({ hasText: editedLogNote });
  await expect(logItem).toContainText("1.25정");
  await expect(logItem).toContainText("13:21");
  await expect(logItem).toContainText("예정 " + keptScheduleTime);
  await logItem.getByRole("button", { name: "삭제", exact: true }).click();

  const logDeleteDialog = page.getByRole("dialog", {
    name: "투약 기록을 삭제할까요?",
  });
  await expect(logDeleteDialog).toContainText(testMedicationName);
  await expect(logDeleteDialog).toContainText("13:21");
  await logDeleteDialog
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page.getByText(editedLogNote, { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "삭제 실행 취소", exact: true })
    .click();
  await expect(page.getByText(/기록을 복원했습니다/)).toBeVisible();
  await expect(
    timeline.getByRole("listitem").filter({ hasText: editedLogNote })
  ).toBeVisible();

  const today = kstDateKey();
  await page.getByRole("link", { name: "상태 기록", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/status\\?date=${today}$`));
  await selectPressed(page.getByRole("button", { name: /^거의 없음/ }));
  await selectPressed(page.getByRole("button", { name: /^평소와 비슷함/ }));
  await selectPressed(page.getByRole("button", { name: /^평소와 같음/ }));
  await selectPressed(page.getByRole("button", { name: /^증상 없음/ }));
  await page
    .getByLabel("기타 메모 (선택)", { exact: true })
    .fill(statusNote);
  await page
    .getByRole("button", { name: /^상태 기록 (저장|수정)$/ })
    .click();
  await expect(page.getByText(/상태를 저장했습니다/)).toBeVisible();

  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "첫 화면", exact: true })
    .click();
  await page
    .getByRole("link", { name: "복용기록 확인", exact: true })
    .click();
  const statusSection = page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: "상태 기록" }),
  });
  await expect(statusSection).toContainText("거의 없음");
  await expect(statusSection).toContainText("평소와 비슷함");
  await expect(statusSection).toContainText("평소와 같음");
  await expect(statusSection).toContainText("증상 없음");
  await expect(statusSection).toContainText(statusNote);

  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "환경설정", exact: true })
    .click();
  const medicationToDelete = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 3,
      name: testMedicationName,
      exact: true,
    }),
  });
  await medicationToDelete
    .getByRole("button", {
      name: `${testMedicationName} 등록된 약 삭제`,
      exact: true,
    })
    .click();
  const medicationDeleteDialog = page.getByRole("dialog", {
    name: "등록된 약을 삭제할까요?",
  });
  await expect(medicationDeleteDialog).toContainText(
    "기존 복용 기록은 삭제되지 않습니다."
  );
  await expect(medicationDeleteDialog).toContainText(
    "약 이름, 복용 시각, 복용 수량을 계속 확인할 수 있습니다."
  );
  await medicationDeleteDialog
    .getByRole("button", { name: "등록된 약 삭제", exact: true })
    .click();
  await expect(medicationToDelete).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "복용기록", exact: true })
    .click();
  const preservedLog = page
    .getByRole("region", { name: "투약 타임라인" })
    .getByRole("listitem")
    .filter({ hasText: editedLogNote });
  await expect(preservedLog).toContainText(testMedicationName);
  await expect(preservedLog).toContainText("13:21");
  await expect(preservedLog).toContainText("1.25정");
});

test("같은 약을 최근 시각에 다시 저장하면 중복 확인을 거친다", async ({
  page,
}) => {
  await page.goto("/");
  const mestinonCard = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: "메스티논",
      exact: true,
    }),
  });
  await mestinonCard.getByRole("link", { name: "복용 기록" }).click();

  await page.getByRole("button", { name: "2정", exact: true }).click();
  await page
    .getByLabel("실제 복용 시각", { exact: true })
    .fill(kstDateTime("11:11"));
  await page
    .getByLabel("메모 (선택)", { exact: true })
    .fill(firstDuplicateNote);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await finishPossibleDuplicateDialog(page);
  await expect(page.getByRole("region", { name: "저장 완료" })).toContainText(
    /메스티논 2정.*기록 완료/
  );

  await page
    .getByRole("button", { name: "같은 약 추가 기록", exact: true })
    .click();
  await page.getByRole("button", { name: "1정", exact: true }).click();
  await page
    .getByLabel("실제 복용 시각", { exact: true })
    .fill(kstDateTime("11:12"));
  await page
    .getByLabel("메모 (선택)", { exact: true })
    .fill(secondDuplicateNote);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();

  const duplicateDialog = page.getByRole("dialog", {
    name: "최근 기록이 있습니다",
  });
  await expect(duplicateDialog).toBeVisible();
  await expect(duplicateDialog).toContainText(/11:1[12]/);
  await duplicateDialog
    .getByRole("button", { name: "새 기록 추가", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "저장 완료" })).toContainText(
    /메스티논 1정.*기록 완료/
  );
});
