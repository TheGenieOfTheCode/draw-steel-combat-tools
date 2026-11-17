const TYPE = 'dsct.signatureSummon';

const signaturePortfolio = (hero) => {
  const portfolios = hero?.system?._summonPortfolios ?? {};
  return Object.keys(portfolios).find((key) => (portfolios[key] ?? []).some((o) => o.cost === null)) ?? null;
};

export function registerSignatureSummon() {
  const Base = ds?.data?.pseudoDocuments?.specialEffects?.BaseSpecialEffect;
  if (!Base || !ds.CONFIG?.SpecialEffect) return;

  class SignatureSummonSpecialEffect extends Base {
    static get TYPE() { return TYPE; }

    static defineSchema() {
      const { SchemaField, NumberField } = foundry.data.fields;
      return Object.assign(super.defineSchema(), {
        summoning: new SchemaField({
          count: new NumberField({ required: true, integer: true, min: 1, initial: 1, nullable: false }),
        }),
      });
    }

    constructButtons() {
      return [ds.utils.constructHTMLButton({
        label: game.i18n.localize('DRAW_STEEL.ChatMessage.PARTS.abilityUse.performSummon'),
        icon: 'fa-solid fa-transporter-2',
        dataset: { specialEffectId: this.id, action: 'performSummon' },
      })];
    }

    async performSummon() {
      const hero = this.document?.actor;
      const key = signaturePortfolio(hero);
      if (!key) return void ui.notifications.error('DRAW_STEEL.Actor.Summoning.Errors.NO_OPTIONS', { localize: true });
      const Advancement = ds.data.pseudoDocuments.advancements.SummonChoiceAdvancement;
      const info = await Advancement.getSummonInfo(hero, key, { signatureOnly: true });
      if (!info) return null;
      return this.parent.performSummon(info.uuid, { count: this.summoning.count, effects: info.effects });
    }
  }

  ds.CONFIG.SpecialEffect[TYPE] = {
    label: 'TYPES.SpecialEffect.dsct.signatureSummon',
    defaultImage: 'icons/svg/mystery-man.svg',
    documentClass: SignatureSummonSpecialEffect,
  };
}
