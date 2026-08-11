"use client";

import type { FC } from "react";
import { CheckIcon, UsersIcon } from "./Icons";
import styles from "./ReferralCaptureNotice.module.css";

export type ReferralCaptureStatus = "signing" | "recording" | "success" | "error";

type ReferralCaptureNoticeProps = {
  status: ReferralCaptureStatus;
  language: "ru" | "en";
  onRetry: () => void;
  onDismiss: () => void;
};

const ReferralCaptureNotice: FC<ReferralCaptureNoticeProps> = ({
  status,
  language,
  onRetry,
  onDismiss,
}) => {
  const copy = COPY[language];
  const isBusy = status === "signing" || status === "recording";
  const isSuccess = status === "success";
  const title = isSuccess
    ? copy.successTitle
    : status === "error"
      ? copy.errorTitle
      : copy.pendingTitle;
  const body = isSuccess
    ? copy.successBody
    : status === "error"
      ? copy.errorBody
      : status === "signing"
        ? copy.signingBody
        : copy.recordingBody;

  return (
    <aside
      className={`${styles.notice} ${isSuccess ? styles.success : ""} ${
        status === "error" ? styles.error : ""
      }`}
      role={status === "error" ? "alert" : "status"}
      aria-live={status === "error" ? "assertive" : "polite"}
    >
      <span className={styles.icon} aria-hidden="true">
        {isSuccess ? <CheckIcon size={18} /> : <UsersIcon size={18} />}
      </span>
      <span className={styles.copy}>
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
      {isBusy && <span className={styles.loader} aria-hidden="true" />}
      {status === "error" && (
        <span className={styles.actions}>
          <button type="button" onClick={onRetry}>{copy.retry}</button>
          <button type="button" onClick={onDismiss}>{copy.dismiss}</button>
        </span>
      )}
      {isSuccess && (
        <button className={styles.close} type="button" onClick={onDismiss} aria-label={copy.close}>
          ×
        </button>
      )}
    </aside>
  );
};

const COPY = {
  ru: {
    pendingTitle: "Подтверждаем приглашение",
    signingBody: "Подпиши безопасное сообщение в кошельке — транзакции и газа не будет",
    recordingBody: "Сохраняем реферала и источник перехода",
    successTitle: "Приглашение подтверждено",
    successBody: "Реферал записан",
    errorTitle: "Реферал пока не записан",
    errorBody: "Подпись отменена либо произошла ошибка кошелька, сети или сервера. Можно повторить",
    retry: "Повторить",
    dismiss: "Не сейчас",
    close: "Закрыть",
  },
  en: {
    pendingTitle: "Confirming your invite",
    signingBody: "Sign a safe wallet message — no transaction or gas is required",
    recordingBody: "Saving the referral and acquisition source",
    successTitle: "Invite confirmed",
    successBody: "The referral has been recorded",
    errorTitle: "Referral not recorded yet",
    errorBody: "The signature was cancelled, or the wallet, network, or server failed. You can retry",
    retry: "Retry",
    dismiss: "Not now",
    close: "Close",
  },
} as const;

export default ReferralCaptureNotice;
