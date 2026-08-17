import { test, expect } from "@playwright/test";

test.describe("홈 화면", () => {
  test("첫 화면에 4개 주요 버튼이 보인다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("투약 관리");
    await expect(page.getByRole("link", { name: "메스티논 기록" })).toBeVisible();
    await expect(page.getByRole("link", { name: "소론도 기록" })).toBeVisible();
    await expect(page.getByRole("link", { name: "오늘 상태" })).toBeVisible();
    await expect(page.getByRole("link", { name: "기록 확인" })).toBeVisible();
  });
});

test.describe("투약 기록", () => {
  test("메스티논 복용 기록 후 첫 화면으로 돌아온다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "메스티논 기록" }).click();
    await expect(page).toHaveURL(/\/log\?med=/);
    await expect(page.getByText("몇 정 드셨나요?")).toBeVisible();

    await page.getByRole("button", { name: "2정" }).click();

    await expect(page.getByText(/기록 완료/)).toBeVisible();
    await expect(page).toHaveURL("/", { timeout: 5000 });
  });

  test("직접 입력으로 복용 개수를 저장한다", async ({ page }) => {
    await page.goto("/log?med=med-mestinon");
    await page.getByRole("button", { name: "직접 입력" }).click();
    await page.getByLabel("복용 개수 직접 입력").fill("3");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText(/기록 완료/)).toBeVisible();
  });
});

test.describe("상태 기록", () => {
  test("오늘 상태를 선택하고 저장한다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "오늘 상태" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("오늘 상태");

    const fatigue = page.getByRole("heading", { level: 2, name: "피로" }).locator("..");
    await fatigue.getByRole("button", { name: "좋음", exact: true }).click();
    await page.getByRole("button", { name: "편안함" }).click();
    await page.getByRole("button", { name: "없음", exact: true }).click();
    await page.getByLabel("기타 메모").fill("오후부터 피곤함");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("오늘 상태를 기록했습니다.")).toBeVisible();
  });
});

test.describe("기록 확인", () => {
  test("기록 확인 화면이 열리고 날짜 이동이 된다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "기록 확인" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("기록 확인");

    const prev = page.getByRole("button", { name: "이전 날짜" });
    await prev.click();
    await expect(page.getByText(/월 \d+일/)).toBeVisible();
  });
});
