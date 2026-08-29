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

test("홈에서 빠른 기록, 상태, 기록 확인, 설정 진입점이 보인다", async ({
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
    page.getByRole("link", { name: "기록 확인", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "약·일정 관리", exact: true })
  ).toBeVisible();
});

test("파비콘과 설치용 앱 아이콘을 제공한다", async ({ page }) => {
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
  expect(source).toContain("renotify: true");
  expect(source).toContain("vibrate: [200, 100, 200]");
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
    page.getByRole("heading", { level: 1, name: "약과 일정 설정" })
  ).toBeVisible();

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
    .getByRole("button", { name: "일정 추가", exact: true })
    .click();
  let scheduleForm = settingsCard.getByRole("group", {
    name: testMedicationName + " 일정 입력",
  });
  await scheduleForm
    .getByLabel("예정 시각", { exact: true })
    .fill(keptScheduleTime);
  await scheduleForm
    .getByLabel("예정 수량 (정)", { exact: true })
    .fill("1.5");
  await scheduleForm
    .getByRole("button", { name: "일정 저장", exact: true })
    .click();
  await expect(
    settingsCard
      .getByRole("listitem")
      .filter({ hasText: keptScheduleTime + " · 1.5정" })
  ).toBeVisible();

  await settingsCard
    .getByRole("button", { name: "일정 추가", exact: true })
    .click();
  scheduleForm = settingsCard.getByRole("group", {
    name: testMedicationName + " 일정 입력",
  });
  await scheduleForm.getByLabel("예정 시각", { exact: true }).fill("22:43");
  await scheduleForm
    .getByLabel("예정 수량 (정)", { exact: true })
    .fill("0.5");
  await scheduleForm
    .getByRole("button", { name: "일정 저장", exact: true })
    .click();

  let temporarySchedule = settingsCard
    .getByRole("listitem")
    .filter({ hasText: "22:43 · 0.5정" });
  await temporarySchedule
    .getByRole("button", { name: "수정", exact: true })
    .click();
  const editScheduleForm = temporarySchedule.getByRole("group", {
    name: testMedicationName + " 일정 입력",
  });
  await editScheduleForm
    .getByLabel("예정 시각", { exact: true })
    .fill(editedScheduleTime);
  await editScheduleForm
    .getByLabel("예정 수량 (정)", { exact: true })
    .fill("1");
  await editScheduleForm
    .getByRole("button", { name: "일정 수정 저장", exact: true })
    .click();

  temporarySchedule = settingsCard
    .getByRole("listitem")
    .filter({ hasText: editedScheduleTime + " · 1정" });
  await expect(temporarySchedule).toBeVisible();
  await temporarySchedule
    .getByRole("button", { name: "일정 삭제", exact: true })
    .click();
  const scheduleDeleteDialog = page.getByRole("dialog", {
    name: "일정을 삭제할까요?",
  });
  await expect(scheduleDeleteDialog).toContainText(testMedicationName);
  await expect(scheduleDeleteDialog).toContainText(editedScheduleTime);
  await scheduleDeleteDialog
    .getByRole("button", { name: "일정 삭제", exact: true })
    .click();
  await expect(
    settingsCard
      .getByRole("listitem")
      .filter({ hasText: editedScheduleTime + " · 1정" })
  ).toHaveCount(0);

  await page
    .getByRole("link", { name: "첫 화면으로 이동", exact: true })
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

  await page.getByRole("link", { name: "기록 확인", exact: true }).click();
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
    .getByRole("link", { name: "첫 화면으로 이동", exact: true })
    .click();
  await page.getByRole("link", { name: "기록 확인", exact: true }).click();
  const statusSection = page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: "상태 기록" }),
  });
  await expect(statusSection).toContainText("거의 없음");
  await expect(statusSection).toContainText("평소와 비슷함");
  await expect(statusSection).toContainText("평소와 같음");
  await expect(statusSection).toContainText("증상 없음");
  await expect(statusSection).toContainText(statusNote);
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
