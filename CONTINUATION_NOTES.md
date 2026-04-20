# プロジェクト継続ノート: symbol-swap-app

## 1. プロジェクト概要
Symbol SDK v3 を使用した、アトミックスワップ形式のファイル売買マーケットプレイス。
- **A (運営)**: 手数料を支払うアグリゲートトランザクションの署名者。
- **B (ユーザーA)**: 出品者（または購入者）。
- **C (ユーザーB)**: 購入者（または出品者）。

## 2. 現在のステータス
- **修正完了**: 
    - SDK v3 のバイナリ化エラー (`offset is out of bounds`) 回避。
    - 署名検証エラー (`Ineligible_Cosignatory`) 解消：メイン署名後のハッシュに対して連署を作成する方式を採用。
    - ネットワーク禁止エラー (`V1_Prohibited`) 解消：`v3` トランザクションを使用。
    - 接続タイムアウト解消：`sym-test-01.opening-line.jp:3001` を使用。
    - アカウント名の一致 (`A`, `B`, `C`) と `data.json` の整合性修正。

- **現在の課題**:
    - トランザクションハッシュは返る（ノードに受理される）が、ウォレットの残高に反映されない。
    - 推定原因: **Aさん（運営）のテストネット残高不足**により、ノード受理後にブロックに取り込まれる際にエラー（`Failure_Core_Insufficient_Balance`）が発生している可能性が高い。

## 3. 次のステップ
1.  **残高確認**: [Symbol Testnet Explorer](https://testnet.symbol.fyi/) で、A, B, C のアドレスの残高を確認する。
2.  **Faucet補充**: 残高が 0 の場合、[Faucet](https://testnet.symbol.fyi/faucet) から XYM を補充する。
3.  **再テスト**: サーバーを起動し、ブラウザをリロード（Ctrl+F5）して、1 XYM の商品で再度「購入」テストを行う。

## 4. 秘密鍵情報 (Testnet)
- A: `CED3DD0A92ECC31FA33C32BF46356255145D9FA93FEE1FB9E11A10CDF39F44BC`
- B: `AB565188DBAC8E824BCB3482FE9DDD8C09DAE130207CB0C777DFCF04EB9124E2`
- C: `57E3B827B2EAF8DA8F77BDDDEB3E17982EBCDADFEC85FEC9B3D3547A3C47F696`
