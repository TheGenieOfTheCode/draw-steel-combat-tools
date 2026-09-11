let _dialog = null;

function _dialogClass() {
  return _dialog ??= class StackedPromptDialog extends foundry.applications.api.DialogV2 {
    
    
    _renderButtons() {
      const buttons = Object.values(this.options.buttons);
      return buttons.map((config, index) => {
        const button = document.createElement('button');
        button.type = config.type ?? 'submit';
        button.dataset.action = config.action;
        button.className = 'dsct-stacked-option';
        button.toggleAttribute('autofocus', !!config.default || (index === 0 && !buttons.some(b => b.default)));

        if (config.img) {
          const img = document.createElement('img');
          img.src = config.img;
          img.alt = '';
          button.appendChild(img);
        } else if (config.icon) {
          const icon = document.createElement('i');
          icon.className = config.icon;
          button.appendChild(icon);
        }

        const label = document.createElement('span');
        label.innerText = config.label;
        button.appendChild(label);

        return button.outerHTML;
      }).join('');
    }

    
    
    async _onSubmit(target, event) {
      if (this.dsctCount > 1) {
        event?.preventDefault?.();
        return this;
      }
      return super._onSubmit(target, event);
    }

    
    _onRender(context, options) {
      super._onRender(context, options);
      if (!(this.dsctCount > 1)) return;

      const picked = [];
      for (const button of this.element.querySelectorAll('.dsct-stacked-option')) {
        if (button.dataset.dsctBound) continue;
        button.dataset.dsctBound = '1';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          const action = button.dataset.action;
          const at = picked.indexOf(action);
          if (at >= 0) picked.splice(at, 1);
          else picked.push(action);
          button.classList.toggle('dsct-stacked-selected', at < 0);
          if (picked.length >= this.dsctCount) this.dsctResolve?.([...picked]);
        });
      }
    }
  };
}

export async function stackedPrompt({ title, heading, options, width = 380, count = 1 }) {
  const config = {
    window: { title },
    classes: ['dsct-stacked-prompt'],
    position: { width },
    content: `<p class="dsct-stacked-heading">${heading}</p>`,
    buttons: options,
  };

  if (count <= 1) return _dialogClass().wait({ ...config, rejectClose: false });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
    };

    const dialog = new (_dialogClass())({
      ...config,
      classes: [...config.classes, 'dsct-stacked-multi'],
      buttons: options.map(o => ({ ...o, type: 'button' })),
    });
    
    dialog.dsctCount = count;
    dialog.dsctResolve = finish;

    dialog.addEventListener('close', () => { if (!settled) { settled = true; resolve(null); } }, { once: true });
    dialog.render({ force: true });
  });
}
