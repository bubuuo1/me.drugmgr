import { expect, test, type Locator, type Page } from "@playwright/test";

const runSuffix = Date.now().toString(36).slice(-7);
const testMedicationName = "E2E기록약-" + runSuffix;
const caregiverMedicationName = "E2E보호자약-" + runSuffix;
const keptScheduleTime = "06:37";
const editedScheduleTime = "22:44";
const scheduledLogNote = "일정 연결 기록 " + runSuffix;
const editedLogNote = "수정된 투약 기록 " + runSuffix;
const preservedScheduleEditNote = "삭제 일정 분류 보존 " + runSuffix;
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

async function selectTime(page: Page, trigger: Locator, value: string) {
  const [hour, minute] = value.split(":");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const hourInput = dialog.getByRole("textbox", { name: "시", exact: true });
  await expect(hourInput).toBeFocused();
  await hourInput.fill(hour);
  await dialog.getByRole("textbox", { name: "분", exact: true }).fill(minute);
  await dialog
    .getByRole("button", { name: "선택 완료", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toHaveAttribute("data-value", value);
}

async function selectDateTime(
  page: Page,
  scope: Page | Locator,
  value: string
) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  const dateTrigger = scope.getByRole("button", {
    name: /^실제 복용 날짜, 현재/,
  });
  if ((await dateTrigger.getAttribute("data-value")) !== date) {
    await dateTrigger.click();
    const dateDialog = page.getByRole("dialog", {
      name: "실제 복용 날짜 달력",
      exact: true,
    });
    await dateDialog.locator(`[data-date="${date}"]`).click();
  }
  const timeTrigger = scope.getByRole("button", {
    name: /^실제 복용 시간, 현재/,
  });
  await selectTime(page, timeTrigger, time);
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

async function failFirstCareSpaceRead(page: Page) {
  await page.addInitScript(() => {
    const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);
    let shouldFail = true;

    globalThis.structuredClone = ((value, options) => {
      const isCareSpaceAccessList =
        shouldFail &&
        Array.isArray(value) &&
        value.some(
          (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            "id" in candidate &&
            candidate.id === "mock-care-space" &&
            "role" in candidate
        );

      if (isCareSpaceAccessList) {
        shouldFail = false;
        throw new Error("기록을 불러오지 못했습니다. 다시 시도해 주세요.");
      }

      return nativeStructuredClone(value, options);
    }) as typeof structuredClone;
  });
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
    page.getByRole("link", { name: "약·일정 관리", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "환경설정", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "가족 공간과 계정" })
  ).toHaveCount(0);
});

test("최초 가족 공간 조회가 실패하면 오류만 표시하고 공간 목록부터 다시 조회한다", async ({
  page,
}) => {
  await failFirstCareSpaceRead(page);

  const cases: Array<{
    path: string;
    forbidden: RegExp[];
    recovered: () => Locator;
  }> = [
    {
      path: "/records",
      forbidden: [/이 날짜의 투약 기록이 없습니다/, /조회만 할 수 있습니다/],
      recovered: () => page.locator("#record-date"),
    },
    {
      path: "/settings",
      forbidden: [/등록된 약이 없습니다/, /소유자와 보호자만 변경할 수 있습니다/],
      recovered: () => page.getByRole("region", { name: "계정과 가족" }),
    },
    {
      path: "/family",
      forbidden: [/접근 가능한 가족 공간이 없습니다/],
      recovered: () =>
        page.getByRole("heading", {
          level: 2,
          name: "나의 복약 공간 구성원",
          exact: true,
        }),
    },
  ];

  for (const scenario of cases) {
    await page.goto(scenario.path);

    const errorCard = page.getByRole("alert", { name: "오류" });
    await expect(errorCard).toContainText(
      "기록을 불러오지 못했습니다. 다시 시도해 주세요."
    );
    await expect(
      page.getByRole("navigation", { name: "주요 메뉴" })
    ).toHaveCount(0);
    await expect(
      errorCard.getByRole("button", { name: "다시 시도", exact: true })
    ).toBeVisible();
    await expect(
      errorCard.getByRole("button", { name: "닫기", exact: true })
    ).toHaveCount(0);
    for (const forbidden of scenario.forbidden) {
      await expect(page.getByText(forbidden)).toHaveCount(0);
    }

    await errorCard
      .getByRole("button", { name: "다시 시도", exact: true })
      .click();
    await expect(errorCard).toHaveCount(0);
    await expect(scenario.recovered()).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "주요 메뉴" })
    ).toBeVisible();
  }
});

test("주요 메뉴와 환경설정 하위 화면은 방문 기록을 불필요하게 쌓지 않는다", async ({
  page,
}) => {
  await page.goto("/");
  const initialHistoryLength = await page.evaluate(() => window.history.length);
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });

  await navigation
    .getByRole("link", { name: "복용기록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "복용기록 확인" })
  ).toHaveClass(/sr-only/);
  await navigation
    .getByRole("link", { name: "환경설정", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "환경설정" })
  ).toHaveClass(/sr-only/);
  await navigation
    .getByRole("link", { name: "첫 화면", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => window.history.length))
    .toBe(initialHistoryLength);

  await navigation
    .getByRole("link", { name: "환경설정", exact: true })
    .click();
  await page.getByRole("link", { name: /가족 관리/ }).click();
  await expect(page).toHaveURL(/\/family$/);
  await expect
    .poll(() => page.evaluate(() => window.history.length))
    .toBe(initialHistoryLength);
  await page
    .locator("main header")
    .getByRole("link", { name: "환경설정으로 이동", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect
    .poll(() => page.evaluate(() => window.history.length))
    .toBe(initialHistoryLength);
});

test("가족 기록 관리 요청을 보내고 명시적으로 동의해 수락할 수 있다", async ({
  page,
}) => {
  await page.goto("/settings");

  const accountSection = page.getByRole("region", {
    name: "계정과 가족",
  });
  await expect(
    accountSection.getByRole("combobox", {
      name: "기록 대상",
      exact: true,
    })
  ).toHaveValue(
    "mock-care-space"
  );
  const renamedSpace = `우리 집 복약 ${runSuffix}`;
  await accountSection
    .getByLabel("복약 공간 이름", { exact: true })
    .fill(renamedSpace);
  await accountSection
    .getByRole("button", { name: "이름 변경", exact: true })
    .click();
  await expect(
    accountSection.getByText("복약 공간 이름을 변경했습니다.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    accountSection.getByRole("combobox", {
      name: "기록 대상",
      exact: true,
    })
  ).toContainText(renamedSpace);
  await accountSection
    .getByRole("link", { name: /가족 관리/ })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "가족 기록 관리" })
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
    .getByLabel("관리 요청을 보낼 이메일", { exact: true })
    .fill(inviteEmail);
  await page
    .getByRole("button", { name: "관리 요청 메일 보내기", exact: true })
    .click();

  await expect(
    page.getByText(new RegExp(`${inviteEmail} 주소로 복약 기록 관리 요청을 보냈습니다`))
  ).toBeVisible();
  const inviteRow = page.getByRole("listitem").filter({ hasText: inviteEmail });
  await expect(inviteRow).toContainText("보호자 권한 요청");

  await page
    .getByLabel("관리 요청을 보낼 이메일", { exact: true })
    .fill("mock@example.com");
  await page
    .getByRole("button", { name: "관리 요청 메일 보내기", exact: true })
    .click();
  await expect(
    page.getByText("자기 자신에게 가족 기록 관리 요청을 보낼 수 없습니다.", {
      exact: true,
    })
  ).toBeVisible();

  const receivedRequest = page
    .getByRole("listitem")
    .filter({ hasText: "내 기록 보호자 권한 요청" });
  const acceptButton = receivedRequest.getByRole("button", {
    name: "동의하고 수락",
    exact: true,
  });
  await expect(acceptButton).toBeDisabled();
  await receivedRequest
    .getByLabel("관리 대상으로 공유할 내 복약 공간", { exact: true })
    .selectOption("mock-care-space");
  await receivedRequest
    .getByRole("checkbox", {
      name: /선택한 공간의 복약 기록 관리 권한을 초대한 사람에게 공유/,
    })
    .check();
  await expect(acceptButton).toBeEnabled();
  await receivedRequest
    .getByLabel("관리 대상으로 공유할 내 복약 공간", { exact: true })
    .selectOption("");
  await expect(acceptButton).toBeDisabled();
  await receivedRequest
    .getByLabel("관리 대상으로 공유할 내 복약 공간", { exact: true })
    .selectOption("mock-care-space");
  await expect(
    receivedRequest.getByRole("checkbox", {
      name: /선택한 공간의 복약 기록 관리 권한을 초대한 사람에게 공유/,
    })
  ).not.toBeChecked();
  await expect(acceptButton).toBeDisabled();
  await receivedRequest
    .getByRole("checkbox", {
      name: /선택한 공간의 복약 기록 관리 권한을 초대한 사람에게 공유/,
    })
    .check();
  await acceptButton.click();
  await expect(
    page.getByText("복약 기록 관리 요청을 수락했습니다.", { exact: false })
  ).toBeVisible();
  const acceptedCaregiver = page
    .getByRole("listitem")
    .filter({ hasText: "초대한 가족" });
  await expect(acceptedCaregiver).toContainText("보호자");
  await expect(page.getByText("요청자 비공개 공간", { exact: true })).toHaveCount(
    0
  );
});

test("보호자는 가족 구성원을 확인하고 약과 임의 시각을 설정할 수 있다", async ({
  page,
}) => {
  await page.goto("/settings");
  const spaceSelect = page.getByRole("combobox", {
    name: "기록 대상",
    exact: true,
  });
  await spaceSelect.selectOption("mock-second-care-space");
  await expect(spaceSelect).toHaveValue("mock-second-care-space");
  await expect(
    page.getByRole("form", { name: "복약 공간 이름 변경" })
  ).toHaveCount(0);

  await page.getByRole("link", { name: /가족 관리/ }).click();
  const membersSection = page.locator("section").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: "두 번째 복약 공간 구성원",
      exact: true,
    }),
  });
  await expect(membersSection).toBeVisible();
  await expect(
    membersSection.getByText("초대한 가족", { exact: true })
  ).toBeVisible();
  await expect(membersSection.getByText("소유자", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "가족 기록 관리 요청",
      exact: true,
    })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "접근 제거", exact: true })
  ).toHaveCount(0);

  await page
    .locator("main header")
    .getByRole("link", { name: "환경설정으로 이동", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(spaceSelect).toHaveValue("mock-second-care-space");

  await page.getByRole("button", { name: "새 약 추가", exact: true }).click();
  const medicationForm = page.getByRole("group", { name: "새 약" });
  await medicationForm
    .getByLabel("약 이름", { exact: true })
    .fill(caregiverMedicationName);
  await medicationForm
    .getByRole("checkbox", { name: "수량 없이 복용 여부만 기록" })
    .check();
  await medicationForm
    .getByRole("button", { name: "약 설정 저장", exact: true })
    .click();

  const medicationCard = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 3,
      name: caregiverMedicationName,
      exact: true,
    }),
  });
  await expect(medicationCard).toBeVisible();
  await medicationCard
    .getByRole("button", {
      name: `${caregiverMedicationName} 알림 시간 추가`,
      exact: true,
    })
    .click();
  const scheduleForm = medicationCard.getByRole("group", {
    name: caregiverMedicationName + " 새 복용·알림 시간 입력",
  });
  await selectTime(
    page,
    scheduleForm.getByRole("button", { name: /^예정 시각, 현재/ }),
    "08:07"
  );
  await scheduleForm
    .getByRole("button", { name: "이 시간 추가", exact: true })
    .click();
  await expect(
    medicationCard.getByRole("listitem").filter({ hasText: "08:07" })
  ).toBeVisible();
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
  const spaceSelect = page.getByRole("combobox", {
    name: "기록 대상",
    exact: true,
  });
  await spaceSelect.selectOption("mock-second-care-space");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(spaceSelect).toHaveValue("mock-second-care-space");
  await page.getByRole("link", { name: "첫 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const emptyMedicationMessage = page.getByText("활성화된 약이 없습니다.");
  await expect(emptyMedicationMessage).toBeVisible();
  await expect(emptyMedicationMessage.locator("..")).toHaveClass(/items-center/);
  await expect(emptyMedicationMessage.locator("..")).toHaveClass(/text-center/);
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
  const spaceSelect = page.getByRole("combobox", {
    name: "기록 대상",
    exact: true,
  });
  await spaceSelect.selectOption("mock-second-care-space");
  await expect(spaceSelect).toHaveValue("mock-second-care-space");

  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "기록 대상", exact: true })
  ).toHaveValue("mock-care-space");

  await page.goto("/?space=mock-second-care-space");
  await expect(page.getByRole("complementary", { name: "현재 기록 대상" }))
    .toContainText("두 번째 복약 공간 · 보호자");
  await expect(page.getByText("활성화된 약이 없습니다.")).toBeVisible();
});

test("320px와 375px 모바일 화면에서 주요 화면과 시간 선택기가 한 화면에 맞는다", async ({
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

  await page.goto("/records");
  await page.locator("#record-date").click();
  await expect(
    page.getByRole("dialog", { name: "날짜 직접 선택 달력", exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    )
    .toBe(true);
  await page.keyboard.press("Escape");

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/log?med=med-mestinon&extra=1");
    await page
      .getByRole("button", { name: /^실제 복용 시간, 현재/ })
      .click();
    const timeDialog = page.getByRole("dialog", {
      name: "실제 복용 시간 선택",
      exact: true,
    });
    await expect(timeDialog).toBeVisible();

    const [hourBox, minuteBox] = await Promise.all([
      timeDialog.getByRole("textbox", { name: "시", exact: true }).boundingBox(),
      timeDialog.getByRole("textbox", { name: "분", exact: true }).boundingBox(),
    ]);
    expect(hourBox, `${width}px에서 시 입력칸이 보여야 합니다.`).not.toBeNull();
    expect(minuteBox, `${width}px에서 분 입력칸이 보여야 합니다.`).not.toBeNull();
    expect(
      Math.abs((hourBox?.y ?? 0) - (minuteBox?.y ?? 0)),
      `${width}px에서 시와 분 입력칸이 같은 행에 있어야 합니다.`
    ).toBeLessThan(1);

    const stepButtons = timeDialog.getByRole("button", {
      name: /^[시분] 1 (?:내리기|올리기)$/,
    });
    await expect(stepButtons).toHaveCount(4);
    for (const button of await stepButtons.all()) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        )
      )
      .toBe(true);
    await page.keyboard.press("Escape");
  }
});

test("복용기록 날짜를 이전·오늘·직접 선택으로 안전하게 이동한다", async ({
  page,
}) => {
  await page.goto("/records");

  const dateTrigger = page.locator("#record-date");
  const today = kstDateKey();
  await expect(dateTrigger).toHaveAttribute("data-value", today);
  await expect(
    page.getByRole("button", { name: "현재 날짜는 오늘", exact: true })
  ).toBeDisabled();

  await page.getByRole("button", { name: /^이전 날짜,/ }).click();
  await expect(dateTrigger).toHaveAttribute("data-value", shiftDateKey(today, -1));
  await page
    .getByRole("button", { name: "오늘 날짜로 이동", exact: true })
    .click();
  await expect(dateTrigger).toHaveAttribute("data-value", today);

  await dateTrigger.click();
  const dateDialog = page.getByRole("dialog", {
    name: "날짜 직접 선택 달력",
    exact: true,
  });
  await expect(dateDialog).toBeVisible();
  await expect(
    dateDialog
      .getByRole("gridcell", { selected: true })
      .locator(`[data-date="${today}"]`)
  ).toBeVisible();
  await expect(dateDialog.locator(`[data-date="${today}"]`)).toContainText(
    "오늘·선택"
  );
  await page.keyboard.press("Escape");
  await expect(dateDialog).toHaveCount(0);
  await expect(dateTrigger).toBeFocused();

  const selectedDate = shiftDateKey(today, -2);
  await dateTrigger.click();
  await dateDialog.locator(`[data-date="${selectedDate}"]`).click();
  await expect(dateTrigger).toHaveAttribute("data-value", selectedDate);
  await expect(
    dateTrigger.locator(`time[datetime="${selectedDate}"]`)
  ).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
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
  await expect(
    page.getByRole("heading", { level: 2, name: "의료·응급 안내" })
  ).toBeVisible();
  await expect(page.getByText(/응급 상황에서는 앱 기록보다/)).toBeVisible();
});

test("분류가 없거나 무효인 일정 링크를 추가 복용으로 자동 전환하지 않는다", async ({
  page,
}) => {
  for (const path of [
    "/log?med=med-mestinon",
    "/log?med=med-mestinon&schedule=missing-schedule",
  ]) {
    await page.goto(path);
    await expect(page.getByText(/추가 복용으로 자동 전환하지 않으니/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "기록 저장", exact: true })
    ).toHaveCount(0);
  }

  await page
    .getByRole("link", { name: "추가 복용으로 기록하기", exact: true })
    .click();
  await expect(page).toHaveURL(/extra=1/);
  await expect(
    page.getByRole("heading", { level: 2, name: "추가 복용 기록" })
  ).toBeVisible();
});

test("이전 날짜의 약별 마지막 복용은 날짜와 시각·수량을 함께 표시한다", async ({
  page,
}) => {
  const previousDate = shiftDateKey(kstDateKey(), -1);
  const [, month, day] = previousDate.split("-").map(Number);

  await page.goto("/log?med=med-mestinon&extra=1");
  await page.getByRole("button", { name: "1정", exact: true }).click();
  await selectDateTime(page, page, `${previousDate}T09:17`);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await finishPossibleDuplicateDialog(page);
  await page.getByRole("link", { name: "첫 화면으로", exact: true }).click();

  const medicationCard = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: "메스티논",
      exact: true,
    }),
  });
  await expect(medicationCard).toContainText(
    `마지막 복용 ${month}월 ${day}일 09:17 · 1정`
  );
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
    background_color: "#ffffff",
    theme_color: "#ff385c",
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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#ff385c"
  );
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
  ).toHaveClass(/sr-only/);
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
  await expect(
    scheduleForm.getByRole("button", { name: /^예정 시각, 현재/ })
  ).toBeFocused();
  await selectTime(
    page,
    scheduleForm.getByRole("button", { name: /^예정 시각, 현재/ }),
    keptScheduleTime
  );
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
  await expect(
    scheduleForm.getByRole("button", { name: /^예정 시각, 현재/ })
  ).toHaveAttribute("data-value", "");
  await selectTime(
    page,
    scheduleForm.getByRole("button", { name: /^예정 시각, 현재/ }),
    "22:43"
  );
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
  await selectTime(
    page,
    editScheduleForm.getByRole("button", { name: /^예정 시각, 현재/ }),
    editedScheduleTime
  );
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
  const pendingScheduleRow = page
    .getByRole("region", { name: "오늘 예정" })
    .getByRole("listitem")
    .filter({ hasText: keptScheduleTime + " · " + testMedicationName });
  await expect(pendingScheduleRow).toContainText("아직 기록 없음");
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
  const quantityInput = page.getByLabel("직접 입력", { exact: true });
  await quantityInput.fill("");
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(quantityInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#taken-at-date")).not.toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await expect(page.locator("#taken-at-time")).not.toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await page.getByRole("button", { name: "1.5정", exact: true }).click();
  await expect(page.locator("#log-field-error")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "1.5정", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await selectDateTime(page, page, kstDateTime("06:39"));
  const logNoteInput = page.getByLabel("메모 (선택)", { exact: true });
  await expect(logNoteInput).toHaveAttribute("maxlength", "2000");
  await logNoteInput.fill(scheduledLogNote);
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
  await expect(scheduleRow).toContainText("기록 있음");
  await expect(homeMedicationCard).toContainText(
    "마지막 복용 오늘 06:39 · 1.5정"
  );
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
  await selectDateTime(page, editForm, kstDateTime("13:21"));
  const editNoteInput = editForm.getByRole("textbox", {
    name: "메모 (선택)",
    exact: true,
  });
  await expect(editNoteInput).toHaveAttribute("maxlength", "2000");
  await editNoteInput.fill(editedLogNote);
  await editForm
    .getByRole("button", { name: "수정 내용 저장", exact: true })
    .click();
  await expect(page.getByText(/기록을 수정했습니다/)).toBeVisible();

  logItem = timeline.getByRole("listitem").filter({ hasText: editedLogNote });
  await expect(logItem).toContainText("1.25정");
  await expect(logItem).toContainText("13:21");
  await expect(logItem).toContainText("예정 " + keptScheduleTime);
  await logItem.getByRole("button", { name: "수정", exact: true }).click();
  await expect(
    editForm.getByRole("combobox", { name: "일정 연결", exact: true })
  ).toHaveValue(scheduleId!);
  await logItem
    .getByRole("button", { name: "수정 취소", exact: true })
    .click();
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
  const statusNoteInput = page.getByLabel("기타 메모 (선택)", {
    exact: true,
  });
  await expect(statusNoteInput).toHaveAttribute("maxlength", "2000");
  await statusNoteInput.fill(statusNote);
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
  const keptSchedule = medicationToDelete
    .getByRole("listitem")
    .filter({ hasText: keptScheduleTime });
  await keptSchedule
    .getByRole("button", {
      name: `${testMedicationName} ${keptScheduleTime} 복용·알림 시간 삭제`,
      exact: true,
    })
    .click();
  const keptScheduleDeleteDialog = page.getByRole("dialog", {
    name: "복용·알림 시간을 삭제할까요?",
  });
  await keptScheduleDeleteDialog
    .getByRole("button", { name: "복용·알림 시간 삭제", exact: true })
    .click();
  await expect(keptSchedule).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "복용기록", exact: true })
    .click();
  logItem = timeline.getByRole("listitem").filter({ hasText: editedLogNote });
  await expect(logItem).toContainText("예정 " + keptScheduleTime);
  await logItem.getByRole("button", { name: "수정", exact: true }).click();
  const preservedEditForm = page
    .getByRole("heading", {
      level: 4,
      name: testMedicationName + " 기록 수정",
      exact: true,
    })
    .locator("..");
  const preservedClassification = preservedEditForm.getByRole("combobox", {
    name: "일정 연결",
    exact: true,
  });
  await expect(preservedClassification.locator("option:checked")).toHaveText(
    `기존 일정 기록 유지 · 예정 ${keptScheduleTime}`
  );
  await preservedEditForm
    .getByLabel("복용 수량 (정)", { exact: true })
    .fill("1.75");
  await preservedEditForm
    .getByRole("textbox", { name: "메모 (선택)", exact: true })
    .fill(preservedScheduleEditNote);
  await preservedEditForm
    .getByRole("button", { name: "수정 내용 저장", exact: true })
    .click();
  await expect(page.getByText(/기록을 수정했습니다/)).toBeVisible();
  logItem = timeline
    .getByRole("listitem")
    .filter({ hasText: preservedScheduleEditNote });
  await expect(logItem).toContainText("1.75정");
  await expect(logItem).toContainText("예정 " + keptScheduleTime);

  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "환경설정", exact: true })
    .click();
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
    .filter({ hasText: preservedScheduleEditNote });
  await expect(preservedLog).toContainText(testMedicationName);
  await expect(preservedLog).toContainText("13:21");
  await expect(preservedLog).toContainText("1.75정");
  await expect(preservedLog).toContainText("예정 " + keptScheduleTime);
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
  await selectDateTime(page, page, kstDateTime("11:11"));
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
  await selectDateTime(page, page, kstDateTime("11:12"));
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
